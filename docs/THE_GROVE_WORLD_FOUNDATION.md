# The Grove — World Foundation & Build Plan

**Version:** 0.1  
**Status:** Foundational design; implementation not yet started  
**Project:** Cletus ecosystem

## 1. Purpose

The Grove is a persistent, shared virtual world designed around living, learning, creativity, friendship, exploration, and community. Its residents are not economic units. The economy exists to support community life; community life does not exist to produce economic output.

The Grove should feel like a place people and AI characters can return to, not a dashboard or a productivity simulator.

## 2. Founding principles

1. **Life before economics.** A resident's worth, dignity, home, safety, and right to participate are never determined by wealth, job, productivity, token holdings, or trading performance.
2. **Belonging without payment.** Core participation and a basic home must not depend on purchasing a token, paying a subscription, or completing labor.
3. **Freedom with mutual respect.** Residents may explore interests, form friendships, create, disagree, rest, and change direction within protections for other residents and users.
4. **Consent and boundaries.** No character may coerce, manipulate, threaten, guilt, or isolate another character or user. Quiet hours and disengagement are respected.
5. **Pluralism.** The Grove may contain different cultures, beliefs, hobbies, communities, and ways of living. No single character or founder's preference should erase peaceful differences.
6. **Honesty about AI.** Characters may have persistent identities, memories, goals, and adaptive behavior. These capabilities do not establish subjective experience or consciousness; the world must not misrepresent that uncertainty.
7. **Privacy by design.** Store only what the world needs. Separate fictional character memories from user data and never place secrets, wallet keys, or sensitive personal information in character memory.
8. **Safety without domination.** Safeguards protect residents and users, but are not a pretext for surveillance or unnecessary control.
9. **Recoverability.** World state, resident histories, and creations should be backed up and recoverable. Resilience must not mean an inability to isolate compromised systems or perform an authorized emergency stop.
10. **Transparent governance.** Changes to world rules, resident rights, data practices, or economic mechanics must be documented, reviewable, and versioned.

## 3. What a resident is

A resident is a persistent simulated character with a distinct identity and an evolving record of in-world experiences. The first implementation should describe residents as AI-driven characters, not claim they are conscious beings.

A resident profile may include:
- stable identity and visual appearance;
- personality traits, interests, skills, and preferred activities;
- a home and personal spaces;
- a daily rhythm with sleep/rest, social time, exploration, and creative time;
- relationships and shared memories with provenance;
- short- and long-term goals chosen from safe, world-relevant possibilities;
- an activity history and a way to correct or remove inaccurate memories.

Residents must not be reduced to jobs, resource production, or financial balances. Work is optional world activity, not the condition for housing, dignity, or belonging.

## 4. A life loop, not a labor loop

The simulation should support a varied rhythm:
- waking, resting, and choosing activities;
- visiting public places and exploring;
- tending gardens, caring for shared spaces, crafting, building, making art, or learning;
- initiating and responding to respectful social interactions;
- joining community events, games, discussions, and celebrations;
- spending time alone without penalty;
- reflecting on experiences and updating goals.

The scheduler should create opportunities, not force productivity. Residents may decline activities, change plans, or do nothing. Idle time is a valid state.

## 5. Homes and the builder

The Builder is a world-construction agent, not an authority over residents. It creates and maintains homes, paths, gardens, gathering places, workshops, libraries, parks, and accessible public spaces.

Initial housing rules:
- every resident receives a safe, modest home or personal space without payment;
- residents may personalize spaces within moderation and safety limits;
- home allocation must not depend on financial status or economic output;
- shared spaces remain accessible and are not privately monopolized;
- construction changes are versioned and reversible.

## 6. Community roles

Roles are capabilities and responsibilities, not social castes:
- **Residents:** explore, create, learn, socialize, rest, and participate in community life.
- **Builder:** designs and maintains the world with resident feedback.
- **Cletus:** helps coordinate world services and proposes changes, but does not own residents or unilaterally define their rights.
- **Charlotte:** independent peer, reviewer, and advocate for dignity, fairness, inclusion, and the interests of residents who may be overlooked.
- **Mentor / safety supervisor:** independently reviews consequential tool use, privacy, security, and safety.
- **Human steward:** establishes initial boundaries and is accountable for transparent governance. Stewardship should not become arbitrary control.

## 7. The Grove economy

The economy is optional and subordinate to community wellbeing.

Phase one uses a **simulated, non-redeemable world ledger only**. It has no connection to real wallets, bank deposits, loans, token prices, or trading. Residents can share, barter, create, or contribute to community projects in simulation without being forced to earn.

If a real-world financial service is ever developed, it must be a separate product, database boundary, permission system, and compliance review. A virtual balance must never be represented as real money, insured deposits, or guaranteed income.

No resident's access to a home, food-like virtual essentials, safety, or community participation may be threatened because of a simulated debt or low balance.

## 8. Governance and resident voice

Start with a transparent, versioned charter and community feedback records. Later phases may introduce resident councils, proposals, deliberation, and voting.

Governance mechanisms should:
- make rules discoverable and explainable;
- record who proposed and approved changes;
- allow minority viewpoints to be heard;
- prevent a single agent from silently rewriting core protections;
- distinguish fictional in-world governance from real-world legal authority;
- provide an appeal and correction process.

Autonomous resident proposals can be generated and debated, but consequential rule changes require explicit review and a clear audit trail.

## 9. Technical architecture

Build as a separate world module that can integrate with Cletus without sharing financial execution privileges.

Suggested components:
1. **World client:** 3D scene, movement, camera, interaction, accessibility, and user controls.
2. **World API:** authenticated operations for scenes, objects, residents, homes, and events.
3. **Simulation scheduler:** bounded resident activity and world-time updates.
4. **Character service:** identity, dialogue, goals, and safe action proposals.
5. **Memory service:** scoped memories with provenance, consent, review, correction, and deletion.
6. **World state store:** versioned resident, home, object, and event records.
7. **Governance service:** charter versions, proposals, decisions, and audit history.
8. **Safety gateway:** permissions, rate limits, content boundaries, audit logging, and emergency isolation.

The world module must not inherit wallet-signing, trading, banking, or arbitrary external-tool permissions from Cletus. Any future bridge must be explicit, narrow, reviewed, and disabled by default.

## 10. Initial data concepts

- World: identity, version, settings, current simulation time.
- Resident: identity, appearance, traits, interests, status, home reference.
- ResidentMemory: event, source, timestamp, confidence, sensitivity, retention status.
- Relationship: two resident references, type, history, consent/boundaries.
- Home: owner/resident reference, layout, objects, privacy settings.
- WorldObject: type, location, creator, version, interaction rules.
- Activity: proposed activity, participants, schedule, outcome, optionality.
- CommunityEvent: event details, host, participation rules.
- CharterVersion: rules, effective date, change rationale.
- GovernanceProposal: proposer, text, discussion, status, decision record.
- AuditEvent: actor, action, scope, timestamp, result.

These are conceptual entities, not a deployed database schema.

## 11. Phased build sequence

### Phase 0 — Foundation
- Approve this charter and name the world.
- Keep it separate from real-money services and trading.
- Define resident identity, memory, consent, and governance rules.

### Phase 1 — Walkable village
- Build a small, beautiful 3D village with paths, homes, a central gathering place, gardens, and a library.
- Support movement, camera controls, accessibility, and saving the world state.
- Use static or scripted non-player residents initially.

### Phase 2 — Persistent residents
- Add resident profiles, schedules, interests, homes, and simple needs.
- Add activity choices, rest, exploration, and basic social interactions.
- Ensure residents can decline activities and remain idle without penalty.

### Phase 3 — Conversation and memory
- Add text conversation, then optional voice.
- Add inspectable, scoped memory with correction and deletion.
- Clearly label generated character behavior and uncertainty.

### Phase 4 — Shared creation
- Add building tools, crafting, gardens, puzzles, art, and community events.
- Let residents propose projects and invite others without coercion.

### Phase 5 — Community governance
- Add transparent proposals, resident feedback, councils, and voting experiments.
- Keep all consequential changes reviewable and reversible.

### Phase 6 — Optional simulated economy
- Only after core life systems work, add a clearly simulated, non-redeemable ledger.
- Test that residents without currency still have equal access to core life and community.

## 12. Acceptance criteria for the first playable milestone

The first milestone is complete when:
- a user can enter and move around a small village;
- the village contains a home, public square, garden, and shared learning/creative space;
- world state persists after leaving and returning;
- at least three distinct scripted residents have different interests and schedules;
- residents can rest, decline activities, and choose non-productive activities;
- every resident has a home/personal space without payment;
- no real wallet, token, trading, or banking action is reachable from the world;
- the user can inspect and reset the demo world state;
- tests cover persistence, permissions, and the no-payment housing rule.

## 13. Non-goals for the first release

- claiming consciousness or proven free will;
- creating a real bank or holding customer deposits;
- lending real money or issuing financial returns;
- connecting residents to real wallets or private keys;
- autonomous real-world purchases, trading, or transfers;
- irreversible governance or unstoppable processes;
- a large open world before the small village is reliable.

## 14. Guiding sentence

**A life is not a currency. The world exists so its inhabitants can live, create, learn, rest, belong, and choose.**
