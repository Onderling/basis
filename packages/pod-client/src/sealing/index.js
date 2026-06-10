// @canopy/pod-client/sealing — opt-in at-rest envelope encryption for pod resources.
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
} from './envelope.js';
export { createSealedPodClient, recipientStrategy, groupKeyStrategy } from './SealedPodClient.js';
export {
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
} from './groupKeyResource.js';
