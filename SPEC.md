# FANUC + UR assembly cell: specification (contract between nodes)

A browser digital twin (three.js, one generated `index.html`) of a small assembly cell:
an infeed conveyor, one FANUC LR Mate 200iD/7L inside a guard fence and one UR5e cobot on the open,
collaborative side.

FANUC, LR Mate, Universal Robots and UR5e are trademarks of their owners.

## 1. Process

A gear-motor housing (aluminium, 120 × 80 × 60 mm, 0.4 kg) gets a cover and four screws.

1. An escapement releases housings onto the **infeed belt** (continuous motion, default speed
   0.10 m/s). The logic chooses release times so each housing reaches the FANUC pick window when
   the FANUC is ready; a housing never leaves the window unpicked.
2. **FANUC** (line tracking): picks the housing from the *moving* belt inside the pick window
   (TCP follows the belt during the 0.30 s grip), and places it in the **fixture**.
   **Dual gripper** (revision 2): two grippers back to back on a pneumatic 180° swivel. The
   FANUC picks housing k from the belt with the free gripper *while the UR is still working on
   k−1*, waits at the fixture approach, then in one fixture visit unloads k−1 with the other
   gripper, swivels (0.40 s), and loads k. It then takes k−1 to the **outfeed belt** (good) or the
   **reject bin** (failed inspection).
   Order per cycle: pick k → [unload k−1 → swivel → load k] (one fixture interval) → place k−1.
   For k = 0 there is nothing to unload: pick 0 → load 0. After the last load, the FANUC returns
   to unload housing 11 and place it.
3. **UR5e** (collaborative): after the FANUC has left the fixture zone, picks a cover from the
   active **cover tray**, places it on the housing, drives 4 screws (blow-fed screwdriver, 1.00 s
   each at the four hole positions), then retreats to its wait pose.
4. **Inspection**: fixed camera above the fixture, 0.80 s, starts only when the UR has left the
   fixture zone. Housings `k ∈ REJECTS` fail.
5. **Operator**: two cover trays of 6. When the active tray is empty the UR switches to the other
   tray and the operator walks in from the aisle, swaps the empty tray (8.0 s inside the scanner
   warning field), and walks out. While the operator is inside the warning field the UR runs at
   reduced speed (TCP ≤ 0.25 m/s). The operator never enters the protective field.

The **fixture** is a mutex: FANUC intervals (unload/load) and UR intervals (cover + screws) and
the camera interval never overlap. The single interlock line is described in §4.

N_PARTS = 12 housings (k = 0…11), REJECTS = {4, 9}. 12 covers are used (rejects get covers too).

## 2. World frame and layout (metres, three.js convention, Y up)

x = flow direction, y = up (floor y = 0), z = towards the operator aisle (+z).
These values are fixed: the logic exports them as `CELL` exactly, the scene draws them.

```js
const CELL = {
  infeed:  { x0: -1.80, x1: 0.10, z: -0.60, top: 0.80, width: 0.30, speed: 0.10 },
  pickWin: { x0: -0.45, x1: -0.05 },            // FANUC pick window on the infeed belt
  outfeed: { x0: 0.30, x1: 1.60, z: -0.40, top: 0.80, width: 0.30, speed: 0.20 },
  fanuc:   { base: [0.00, 0.60, -0.05], yaw: 0 },        // pedestal top = robot mounting plane
  ur:      { base: [0.00, 0.80, 0.85], yaw: Math.PI },   // table top = robot mounting plane
  fixture: { pos: [0.00, 0.80, 0.25] },                  // table top centre under the housing
  rejectBin: { pos: [-0.45, 0.65, 0.20], size: [0.30, 0.25, 0.30] }, // pos = top-centre of opening
  trays:   [ { pos: [0.55, 0.80, 0.95] }, { pos: [0.55, 0.80, 1.20] } ], // 2 × 3 grid, pitch 0.10
  camera:  [0.00, 1.45, 0.25],
  scanner: { center: [0.00, 0.85], warn: 1.20, protect: 0.60 }, // xz centre, radii
  operator:{ aisle: [0.55, 2.40], station: [0.55, 1.70] },      // xz positions
  fence:   { x0: -1.00, x1: 1.00, z0: -0.95, z1: 0.30, h: 2.00 }, // window at the fixture
  housing: [0.12, 0.06, 0.08],                                   // x, y, z size
};
```

## 3. Robots (published data; the logic declares them as below)

**FANUC LR Mate 200iD/7L**, 6 axes, payload 7 kg, reach 911 mm. Kinematics (FANUC style):
J1 axis height above the mounting plane 0.330, a1 = 0.050, a2 = 0.440, a3 = 0.035, d4 = 0.420,
d6 = 0.080 (flange). Motion ranges (totals): J1 340°, J2 245°, J3 430°, J4 380°, J5 250°, J6 720°.
Max joint speeds: 370, 310, 410, 550, 545, 1000 °/s. Gripper: TCP 0.100 below the flange.
Dual gripper on a 180° swivel whose axis is perpendicular to the flange axis: the *active*
gripper always points along the flange axis with its TCP 0.100 from the flange, so FK/IK use a
single tool length. Swivel time 0.40 s; each gripper holds one housing.
Planned TCP speed ≤ 1.50 m/s, acceleration ≤ 6 m/s².

**UR5e**, 6 axes, payload 5 kg, reach 850 mm. DH: d1 = 0.1625, a2 = −0.425, a3 = −0.3922,
d4 = 0.1333, d5 = 0.0997, d6 = 0.0996. All joints ±360°. Max joint speed 180 °/s.
Tool (gripper + screwdriver): TCP 0.150 from the flange along the tool axis.
Planned TCP speed ≤ 1.00 m/s, ≤ 0.25 m/s while the operator is inside the warning field,
acceleration ≤ 2.5 m/s².

If a datasheet value above is found wrong, correct it in the logic, cite the source in a comment,
and list the correction in `DATE_ROBOTI.md` (value, source URL). Do not edit this file.

## 4. Logic block API (`src/js/10-logic.js`)

The logic lives between the lines `// @@logic-start` and `// @@logic-end`. It is plain JS with
no imports and no DOM/three.js use, so `tests/run.mjs` can evaluate it with
`new Function(code + "\nreturn {...}")`. It must define these top-level names:

| name | meaning |
|---|---|
| `CELL` | §2, exactly |
| `FANUC`, `UR` | `{ name, dh, lim: [[lo,hi]×6] (rad), vmax: [6] (rad/s), tool, vTcp, aTcp }` |
| `N_PARTS`, `REJECTS` | 12, `new Set([4, 9])` |
| `INTERLOCK_LAG` | `const INTERLOCK_LAG = 0;` written exactly like this, once |
| `fanucFK(q)`, `urFK(q)` | world TCP pose `{ p: [x,y,z], R: [[3]×3] }` (includes base pose and tool) |
| `fanucIK(p, R, qRef)`, `urIK(p, R, qRef)` | joint vector closest to `qRef`, within limits, or `null` |
| `rebuild(beltSpeed)` | builds the model, makes it current, returns it |
| `cycleFor(beltSpeed)` | builds and returns a model without changing the current one |
| `current()` | the current model |

Every time a robot or the camera waits for the fixture it computes its start as
`Math.max(tReady, fixtureFree - INTERLOCK_LAG)`; `tests/run.mjs --perturb` replaces
`const INTERLOCK_LAG = 0;` with `const INTERLOCK_LAG = 1.5;` and the mutex check must then fail.

**Model** returned by `rebuild` / `cycleFor`:

```js
{
  beltSpeed, DURATION,                      // s; cycle = last housing settled on outfeed / in bin
  parts: [{ k, reject, release, pick: { t, tcp: [3], part: [3] }, dest: "out" | "bin",
            screws: 4, cover: true, end: { t, p: [3] } }],
  segs:  { fanuc: [{ t0, t1, kind }], ur: [...], camera: [...], operator: [...] }, // contiguous 0…DURATION
  zones: { fixture: { fanuc: [[t0,t1]], ur: [[t0,t1]], camera: [[t0,t1]] } },
  S: { dt: 0.02, t: [], fq: [[6]], uq: [[6]], fTcp: [[3]], uTcp: [[3]], opIn: [bool], opPos: [[2]],
       fGrip: [0|1], fSwivel: [rad 0…π], fHeld: [[kA|null, kB|null]] }, // active gripper, swivel angle, housings held
  trays: { swaps: [{ t0, t1, tray }] },
  minClear: { m, at },                      // FANUC–UR capsule distance, m, s
  util: { fanuc, ur, camera },              // busy fraction 0…1
}
```

`kind` values: fanuc `wait|pick|load|unload|swivel|place_out|place_bin|move`; ur
`wait|cover|screw|move`; camera `wait|inspect`; operator `away|walk_in|swap|walk_out`.
Capsules for clearance: one per link (radius FANUC 0.06, UR 0.055), plus the tool (0.05).

## 5. Acceptance checks (`tests/run.mjs`, written before the logic)

`node tests/run.mjs [file.html] [--perturb]`, exit 0 all pass, 1 any FAIL, 2 logic block or
perturbation target missing, 3 exception during evaluation. Checks, for belt speeds
0.05, 0.10, 0.15, 0.20 m/s:

1. `CELL` deep-equals §2; `N_PARTS`, `REJECTS` as above; `FANUC`/`UR` constants as §3
   (DH, range totals, vmax, tool, TCP limits; tolerance 1e-9 or the corrected value listed in
   `DATE_ROBOTI.md`).
2. All 12 housings end before `DURATION`; 10 on the outfeed, rejects {4, 9} in the bin, every one
   with a cover and 4 screws; covers used = 12; at least one tray swap.
3. Fixture mutex: FANUC, UR and camera intervals pairwise disjoint; housing k loaded only after
   k−1 unloaded; camera only after UR screws on the same housing; UR only after load.
   Dual gripper (rev. 2): per k ≥ 1 the FANUC order is pick k → unload k−1 → swivel → load k →
   place k−1, with unload k−1, swivel and load k inside one FANUC fixture interval; pick k ends
   before the UR finishes the screws of k−1 for every k ≥ 2 (the pick overlaps the UR work);
   `S.fHeld` never shows more than 2 housings or one housing in both grippers; every swivel
   segment lasts 0.40 s and flips `S.fGrip`. Throughput at the default belt speed 0.10 m/s:
   `util.ur` ≥ 0.70 (reported under check 3).
4. Segments contiguous from 0 to `DURATION` per actor.
5. Line tracking: pick time inside the pick window for the housing's belt position; `|tcp − part|`
   ≤ 2 mm at pick start and end; the housing is on the belt (y = top) until pick start.
6. IK round trip, 300 random joint vectors within limits per robot: `FK(IK(FK(q)))` matches
   `FK(q)` within 0.1 mm and 0.1°.
7. Trajectories: at every sample, joints within `lim`; joint step ≤ `vmax · dt · 1.05`;
   `FK(S.fq[i])` = `S.fTcp[i]` and `FK(S.uq[i])` = `S.uTcp[i]` within 0.1 mm.
8. TCP speed (finite difference): FANUC ≤ 1.50 m/s, UR ≤ 1.00 m/s, UR ≤ 0.25 m/s at every sample
   where `opIn` (1 % tolerance); `opIn` true for at least 8 s total; operator never closer than
   `scanner.protect` to the scanner centre.
9. `minClear.m` ≥ 0.050 m.
10. `DURATION` nonincreasing as belt speed rises; `cycleFor(x)` equals `rebuild(x)` and leaves
    `current()` untouched; two rebuilds give identical models (deterministic).
11. With `--perturb` the run must exit 1 with a FAIL on check 3.

The default model (0.10 m/s) prints cycle time, per-robot utilisation and min clearance.

## 6. Page hooks (for `tests/scene.mjs`, Playwright)

The page sets `window.__cell = { ready: true, seek(t), flange(name), tcp(name), errors: [] }`
once the scene is built. `seek(t)` poses the scene at time t and renders one frame. `tcp("fanuc")`
/ `tcp("ur")` return the world TCP position `[x,y,z]` of the *drawn* robot (from its mesh
hierarchy, not from the logic arrays). `?t=<s>` starts paused at time s; `?shot=<view>` hides
the UI for stills. Views: `iso`, `front`, `side`, `top`, `fanuc`, `ur`, `operator`.

`tests/scene.mjs` serves the folder on 127.0.0.1, opens `index.html` in Playwright
(`import("/opt/homebrew/lib/node_modules/playwright/index.mjs")`, `chromium.launch({ channel: "chrome" })`),
and checks: zero console errors; at 12 evenly spaced times the drawn TCPs match the logic
`S.fTcp`/`S.uTcp` within 2 mm.

## 7. Files and outputs

- `src/page.html` + `src/js/NN-*.js` → `node tools/build.mjs` → `index.html` (never edit by hand)
- `tools/shots.mjs` → `~/Downloads/fanuc-ur-cell/shots/*.png`
- `tools/record.mjs` → `~/Downloads/fanuc-ur-cell/media/fanuc_ur_cell.mp4` (H.264, yuv420p,
  1920×1080, 30 fps, one full cycle)
- Everything stays local. No git push, no publishing.
