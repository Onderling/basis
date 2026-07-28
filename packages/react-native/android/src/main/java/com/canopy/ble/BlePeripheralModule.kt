package org.onderling.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/**
 * BlePeripheralModule — Android GATT server for BLE peripheral mode.
 *
 * Exposes to JS:
 *   start(serviceUuid, characteristicUuid): Promise   — start GATT server + advertising
 *   stop(): Promise                                    — stop everything
 *   notify(deviceAddress, characteristicUuid, b64):   — send notification to a connected central
 *       Promise
 *
 * JS events emitted:
 *   BlePeripheralDeviceConnected   { address }
 *   BlePeripheralDeviceDisconnected{ address }
 *   BlePeripheralWrite             { address, characteristicUuid, value (base64) }
 *   BlePeripheralMtuChanged        { address, mtu }
 *   BlePeripheralAdvertiseError    { errorCode, message }
 *
 * The characteristic is set up with WRITE + WRITE_NO_RESPONSE + NOTIFY so the
 * central can write to us (inbound data) and we can notify back (outbound data).
 * A CCCD descriptor (0x2902) is included so centrals can subscribe to notifications.
 */
class BlePeripheralModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "BlePeripheral"
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    override fun getName() = MODULE_NAME

    private val btManager by lazy {
        reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    }
    private var gattServer:  BluetoothGattServer? = null
    private var advertiser:  BluetoothLeAdvertiser? = null

    // device address → BluetoothDevice (connected centrals)
    private val connected   = mutableMapOf<String, BluetoothDevice>()
    // device address → negotiated MTU (default 20 until onMtuChanged fires)
    private val mtuMap      = mutableMapOf<String, Int>()

    // ── JS-callable API ────────────────────────────────────────────────────────

    @ReactMethod
    fun start(serviceUuidStr: String, charUuidStr: String, promise: Promise) {
        try {
            val serviceUuid = UUID.fromString(serviceUuidStr)
            val charUuid    = UUID.fromString(charUuidStr)

            val cccd = BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            val characteristic = BluetoothGattCharacteristic(
                charUuid,
                BluetoothGattCharacteristic.PROPERTY_WRITE          or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            ).also { it.addDescriptor(cccd) }

            val service = BluetoothGattService(
                serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY
            ).also { it.addCharacteristic(characteristic) }

            val adapter = btManager.adapter
                ?: return promise.reject("BLE_NOT_SUPPORTED", "Bluetooth not available on this device")
            if (!adapter.isEnabled)
                return promise.reject("BLE_DISABLED", "Bluetooth is off — please enable it")

            gattServer = btManager.openGattServer(reactApplicationContext, gattCallback)
                ?: return promise.reject("BLE_GATT_FAILED", "openGattServer returned null")
            gattServer!!.addService(service)

            advertiser = adapter.bluetoothLeAdvertiser
                ?: return promise.reject("BLE_ADV_NOT_SUPPORTED", "BLE advertising not supported on this device")
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .build()
            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(ParcelUuid(serviceUuid))
                .build()
            advertiser?.startAdvertising(settings, data, advertiseCallback)

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_START", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
            advertiser = null
            gattServer?.close()
            gattServer = null
            connected.clear()
            mtuMap.clear()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_STOP", e.message, e)
        }
    }

    /**
     * Send a GATT notification to a connected central.
     * @param deviceAddress  BT address of the central (from BlePeripheralDeviceConnected)
     * @param charUuidStr    characteristic UUID (must match the one passed to start())
     * @param valueB64       base64-encoded bytes to send (matches react-native-ble-plx framing)
     */
    @ReactMethod
    fun notify(deviceAddress: String, charUuidStr: String, valueB64: String, promise: Promise) {
        try {
            val device = connected[deviceAddress]
                ?: return promise.reject("BLE_DEVICE_NOT_FOUND", "Not connected: $deviceAddress")
            val server = gattServer
                ?: return promise.reject("BLE_NOT_STARTED", "GATT server not running")

            val charUuid = UUID.fromString(charUuidStr)
            val char     = server.services
                .flatMap { it.characteristics }
                .firstOrNull { it.uuid == charUuid }
                ?: return promise.reject("BLE_CHAR_NOT_FOUND", "No characteristic $charUuidStr")

            char.value = Base64.decode(valueB64, Base64.NO_WRAP)
            server.notifyCharacteristicChanged(device, char, false /* confirm = false → notify */)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BLE_NOTIFY_FAILED", e.message, e)
        }
    }

    // Required boilerplate for React Native NativeEventEmitter
    @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}
    @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {}

    // ── GATT server callback ───────────────────────────────────────────────────

    private val gattCallback = object : BluetoothGattServerCallback() {

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val addr   = device.address
            val params = Arguments.createMap().also { it.putString("address", addr) }
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connected[addr] = device
                emit("BlePeripheralDeviceConnected", params)
            } else {
                connected.remove(addr)
                mtuMap.remove(addr)
                emit("BlePeripheralDeviceDisconnected", params)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
            emit("BlePeripheralWrite", Arguments.createMap().also {
                it.putString("address",            device.address)
                it.putString("characteristicUuid", characteristic.uuid.toString())
                it.putString("value",              Base64.encodeToString(value, Base64.NO_WRAP))
            })
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray
        ) {
            // Central subscribing/unsubscribing from notifications — just acknowledge.
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            mtuMap[device.address] = mtu
            emit("BlePeripheralMtuChanged", Arguments.createMap().also {
                it.putString("address", device.address)
                it.putInt("mtu", mtu)
            })
        }
    }

    // ── Advertise callback ─────────────────────────────────────────────────────

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
            emit("BlePeripheralAdvertiseError", Arguments.createMap().also {
                it.putInt("errorCode", errorCode)
                it.putString("message", "BLE advertising failed (errorCode=$errorCode)")
            })
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private fun emit(event: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }
}
