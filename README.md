# FANUC + UR assembly cell

A browser digital twin of a small assembly cell. Twelve aluminium gear-motor housings (120 × 80 × 60 mm, 0.4 kg) each receive a cover and four screws. An escapement releases the housings onto a moving infeed belt. A FANUC LR Mate 200iD/7L inside the guard line-tracks the belt. Two grippers sit back to back on a pneumatic 180° rotator: the robot picks the next housing while the cobot is still at the fixture, then in one visit unloads the finished housing, swivels, and loads the new one. Housings that pass inspection leave on the outfeed belt. Two of the twelve fail inspection and go to a reject bin. A UR5e on the open side places each cover and drives the four screws. A fixed camera above the fixture inspects the assembly after the cobot has left. When a cover tray is empty, an operator walks in from the aisle, swaps the tray inside the scanner warning field, and walks out. While the operator is in that field the cobot keeps its TCP at or below 0.25 m/s. The operator does not enter the protective field.

three.js is stored in this folder, so the page is served locally. From this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/. A double-click does not work: the page uses ES modules, which a browser will not load from file://.

## What is in this build

- Robots sized from published datasheets, with joint limits and inverse kinematics: FANUC LR Mate 200iD/7L (6 axes, payload 7 kg, reach 911 mm) and UR5e (6 axes, payload 5 kg, reach 850 mm, elbow ±160°)
- Dual gripper on the FANUC: two grippers on the 180° rotator. The HMI shows the active gripper, the housing in each gripper, and the swivel angle
- A guard around the FANUC, a stack light, and an HMI
- A collaborative zone with a safety scanner (warning field and protective field) and an operator
- Belt-speed what-if from 0.05 to 0.20 m/s: the cycle, interlocks, and clearances are recomputed from the same schedule. At 0.10 m/s, `node tests/run.mjs` reports cycle 258.70 s, utilisation FANUC 55.2%, UR 78.7%, camera 3.7%, minimum clearance 144.0 mm

## Checks

```sh
node tools/build.mjs           # concatenate src/ into index.html
node tests/run.mjs             # schedule, mutexes, IK, joint limits, clearance
node tests/run.mjs --perturb   # shifts the fixture interlock: mutex and clearance checks must fail
node tests/scene.mjs           # drawn TCP against the logic samples
node tools/shots.mjs           # stills of the seven views
node tools/record.mjs          # cycle film
```

## Layout

`src/page.html` is the shell. `src/js/*.js` are concatenated in lexical order into one module by `tools/build.mjs`. `index.html` is generated. Do not edit it by hand. `vendor/three/` holds three.js 0.186.1 from npm, with the MIT license in the tree.

FANUC, LR Mate, Universal Robots and UR5e are trademarks of their owners.
