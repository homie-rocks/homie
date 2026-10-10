The collision and terrain source here is pinned to studio 0.45.0, release commit
b04e6a714c71dfaa046e0ce9be3f97871e4bf62b. Only import paths changed to share the
unchanged map index, guard counter and types with the compatibility harness.
The seeded test compares both results and charged units on the two 3D starters,
the Stormbreak terrain fixture and a solid slope/overhang fixture.
