# Property vocabulary — how an agent expresses queryable properties

An agent exposes, alongside its **skills** (things it can do) and **data** (things it holds), a set of
**properties** — queryable attributes about the user or their possessions/devices (age, place, availability; a
tool to lend; a robot's battery). This page is the standard for *how a property is expressed* so that both
humans and bots/drones can understand it. The *why* (and the alternatives weighed) is in
[`../decisions.md`](../decisions.md) (2026-07-14 — Agent property vocabulary).

> Status: **the properties facet is being designed, not yet built.** This is the standard it will follow — not
> yet enforced by a fitness function. Written down now so it doesn't drift when it lands.

## The rule

1. **A property is a JSON-LD typed value under a namespaced-URI key.** The URI makes it self-describing: a
   caller resolves the term and knows the type, with no prior agreement.
2. **The vocabulary is open, not a closed enum.** Use a **standard** term when one exists (so the common
   properties are mutually understood); extend with any JSON-LD term for the rest.
3. **Baseline term sources:**
   - **Human/personal:** [schema.org](https://schema.org) (incl. `Offer`/`Product` for shareable possessions),
     **FOAF** + **vCard** (Solid-native people/contact — what WebID profiles speak), and **OpenID Connect
     standard-claim names** (`birthdate`, `address`, …) where they are the obvious field.
   - **Device/robot:** **W3C Web of Things (WoT) Thing Description** — the standard for a thing's queryable
     properties/actions/events ("battery left", location, status).
4. **Every *declared* property carries a `cdi:ladder`** — the coarsening rungs from most→least revealing, so the
   property can be disclosed at graduated precision (see the policy layer below). `cdi:` (onderling-disclosure) is
   Onderling's own thin namespace; it is the only non-standard part, and it carries *policy*, not vocabulary.
5. **Anything not declared** is reached only through a consent-gated query path (a separate, deferred mechanism)
   — never auto-answered.

## Shape

```json
{
  "@context": ["https://schema.org/", "https://www.w3.org/2019/wot/td/v1",
               {"cdi": "https://onderling.org/ns/disclosure#"}],
  "location": { "@type": "GeoCoordinates", "value": {"lat": 52.7, "long": 5.1},
                "cdi:ladder": ["coords", "district", "municipality", "region", "in-area", "none"] },
  "lendable": [ { "@type": "Offer", "itemOffered": {"@type": "Product", "name": "drill"},
                  "cdi:ladder": ["item", "category", "none"] } ],
  "battery":  { "@type": "PropertyAffordance", "value": 0.82,
                "cdi:ladder": ["percent", "band", "none"] }
}
```

## Adding a new property

1. Pick the **standard term** if one exists (schema.org/FOAF/vCard/OIDC for people, WoT for devices); otherwise
   mint a namespaced term.
2. Define its **`cdi:ladder`** (rungs, most→least revealing; a predicate like `adult(y/n)` is a good coarsest
   rung).
3. Done — the property is now declarable and disclosable at a chosen rung.

## What this convention does NOT cover

The **policy** layer is separate and richer than a vocabulary: a **persona** (a named bundle of property
*values*, incl. a decoy), a **disclosure level** (audience → which properties at which rung), and the
**security tier** (auth certainty — the gate, from `TrustRegistry`). This page is only about the *terms* and the
*ladder*; properties are a **manifest facet** (see [`manifest-standard.md`](./manifest-standard.md)), advertised
on the A2A agent card and filtered by the caller's trust tier at a *rung* (coarsened value), not binary
show/hide.
