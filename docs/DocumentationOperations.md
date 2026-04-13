# Documentation Operations

## Purpose

This document standardizes how requirement, design, user-manual, and test documents are updated so that product behavior and operational knowledge stay in sync.

## Update Rules

1. `Requirement.md`
   Update when scope, user flow, constraints, or acceptance expectations change.
2. `SoftwareDesign.md`
   Update when data structures, APIs, state handling, or UI composition changes.
3. `UserManual.md`
   Update when a user-visible workflow changes, a new screen is added, or keyboard/export behavior changes.
4. `UnitTestSpecification.md`
   Update when new regression risks are introduced or test coverage expectations change.

## Minimum Timing

1. During implementation planning:
   Add or update requirement notes for any approved scope change.
2. During implementation:
   Capture design-impact notes before merge when API or state structure changes.
3. Before review completion:
   Refresh user-manual and test-spec references for all user-visible changes.
4. After release:
   Record known limitations and deferred items within the relevant document.

## Ownership

- Feature owner:
  Updates requirement and design sections.
- Reviewer:
  Confirms documentation changes match implemented behavior.
- Release owner:
  Confirms user guidance and regression notes are ready before shipment.

## Documentation Checklist

- New screen or panel is described.
- New API or payload shape is documented.
- Keyboard shortcuts are listed when behavior changes.
- Export/import behavior and templates are explained.
- Empty-state and onboarding behavior are captured.
- Test expectations mention newly added risks.
