# @onderling/relay

The relay is a message broker. Agents register an address by proving they hold its key, and the relay forwards
envelopes to the socket that holds the address. For an address that is offline it holds them for a while, and it can
wake a sleeping phone. It knows which addresses exist and who controls them, and never which circles exist or who
belongs to them. See the header of `src/server.js` for the full protocol and what the relay learns.

Boot it with `bin/relay.js` (the CLI) or `deploy/relay/entrypoint.mjs` (the hosted image). Both read their options
from the environment and document them at the top of the file.

## The seat: the relay asking a node for a link's file

A household's companion keeps each person's agenda file, sealed to a key that only that person's link carries. The
companion runs where the household is and has no public port. A calendar app can only fetch a URL, so the link points
at the relay: `https://<relay>/feed/<node>/<id>.<k>.ics`. The relay asks that node for the file over the node's own
connection and passes the answer on (`src/feedForward.js`, `startRelay({ feeds })`, turned on in both boot doors).

To ask anything, the relay needs an agent of its own. That agent is the **seat**.

- **Its key is new at every start.** It is generated in memory and never stored. Both boot doors print it in their
  banner (`Feeds: … seat <address>`). In its hello it calls itself `relay-feed`.
- **It asks one thing.** It sends `feed.serve({id, k})`, after a hello, to the node a link names, and nothing else.
  The ask is bounded at 15 s and never retried.
- **It uses live sockets only.** What it sends goes to the node's connected socket or nowhere. It is never held for an
  offline address and never wakes anyone. Nothing it sends or receives is logged.
- **It is never a client.** It is not in the routing table, registers no address, and takes envelopes only from a node
  it is asking at that moment.
- **It is bounded per node.** At most two asks are in flight to one node; a third waits for a place. Concurrent asks
  share one hello. A node that refuses (it has no `feed.serve`, its gate denies, it answers with something that is no
  answer) is not asked again for a minute: no hello, just the miss. A companion's own miss (a wrong key, no file) and a
  timeout do not count as refusals.

Anyone who can send a GET can name any node in a link, so the seat can be pointed at any connected address. For a node
that is no companion, that costs at most one hello and one refused ask a minute. A node operator who wants none at all
can refuse hellos from the key in the relay's banner, or from any agent that labels itself `relay-feed` (a label is
the agent's own claim, so the key is the reliable mark).

Every miss is the same 404 with the same body, and every miss after a path parses takes at least a second. So the
route says nothing about whether an address is connected.

| Parameter | Default | Meaning |
|---|---|---|
| `relay.feedServeTimeoutMs` | 15 000 | the bound on one ask (hello and ask together) |
| `relay.feedMaxInFlight` | 32 | asks in flight at once, all nodes together |
| `relay.feedMaxPerNode` | 2 | asks in flight to one node; a further one waits |
| `relay.feedRefusedTtlMs` | 60 000 | how long a node that refused is not asked |
| `relay.feedMissFloorMs` | 1 000 | no miss after a parsed path answers sooner |
