const housingHalf = CELL.housing[1] / 2;
const screwHeadHeight = 0.006;
const partMeshes = Array.from({ length: N_PARTS }, (_, k) => {
  const center = robotFrame(world, "Housing center " + k);
  makeHousingMesh(center).position.y = -housingHalf;
  const cover = makeCoverMesh(center);
  cover.position.y = housingHalf;
  cover.name = "Cover " + k;
  const screws = SCREW_OFFSETS.map(([x, z], i) => {
    const screw = makeScrewMesh(center);
    screw.position.set(x, housingHalf + COVER_H - screwHeadHeight, z);
    screw.name = "Screw " + k + ":" + i;
    return screw;
  });
  return { center, cover, screws };
});
const urCover = makeCoverMesh();
urCover.name = "UR carried cover";
const urScrew = makeScrewMesh();
urScrew.name = "UR carried screw";

const partTimelineCache = new WeakMap();
function partSchedule() {
  const model = current();
  if (partTimelineCache.has(model)) return partTimelineCache.get(model);
  const timeline = model.parts.map(({ k }) => {
    const fanuc = model.segs.fanuc.filter(s => s.k === k);
    const ur = model.segs.ur.filter(s => s.k === k);
    const screws = ur.filter(s => s.kind === "screw").map(s => ({
      ...s, approach: model.segs.ur[model.segs.ur.indexOf(s) - 1].t0,
    }));
    return {
      load: fanuc.find(s => s.kind === "load").t1,
      release: fanuc.find(s => s.kind === "place_bin" || s.kind === "place_out").t1,
      acquire: ur.find(s => s.kind === "move").t1,
      cover: ur.find(s => s.kind === "cover").t1,
      screws,
    };
  });
  partTimelineCache.set(model, timeline);
  return timeline;
}

// Approach poses use lcDown: tool +Z is world -Y. Part +Y is up, so it maps onto -tool Z.
const rotationFromTool = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -HALF_PI);
function placeOnTool(object, marker, bottomOffset) {
  marker.getWorldPosition(object.position);
  marker.getWorldQuaternion(object.quaternion).multiply(rotationFromTool);
  object.position.add(V(0, -bottomOffset, 0).applyQuaternion(object.quaternion));
}

function poseTrays(t, timeline) {
  const { trays, segs } = current();
  const [aisleX, aisleZ] = CELL.operator.aisle;
  const [, stationZ] = CELL.operator.station;
  const carryZ = stationZ - 0.18;
  const aisleCarryZ = aisleZ - 0.20;
  const carryY = 0.96;

  trayGroups.forEach((emptyGroup, tray) => {
    const spareGroup = spareTrayGroups[tray];
    const [x, y, z] = CELL.trays[tray].pos;
    const swap = trays.swaps.find(s => s.tray === tray);
    trayCoverMeshes[tray].forEach((cover, slot) => {
      cover.visible = t < timeline[tray * 6 + slot].acquire;
    });
    if (!swap) {
      emptyGroup.visible = true;
      emptyGroup.position.set(x, y, z);
      spareGroup.visible = false;
      return;
    }
    const opSegs = segs.operator;
    const swapIdx = opSegs.findIndex(s => s.kind === "swap" && s.t0 <= swap.t0 + 1e-6 && s.t1 >= swap.t1 - 1e-6);
    const walkIn = swapIdx > 0 && opSegs[swapIdx - 1].kind === "walk_in" ? opSegs[swapIdx - 1] : null;
    const walkOut = swapIdx >= 0 && opSegs[swapIdx + 1]?.kind === "walk_out" ? opSegs[swapIdx + 1] : null;

    if (t < swap.t0) {
      emptyGroup.visible = true;
      emptyGroup.position.set(x, y, z);
      if (walkIn && t >= walkIn.t0) {
        const p = clamp((t - walkIn.t0) / (walkIn.t1 - walkIn.t0), 0, 1);
        spareGroup.visible = true;
        spareGroup.position.set(lerp(aisleX, x + 0.18, p), carryY, lerp(aisleCarryZ, carryZ, p));
      } else {
        spareGroup.visible = false;
      }
    } else if (t <= swap.t1) {
      const p = clamp((t - swap.t0) / (swap.t1 - swap.t0), 0, 1);
      // 0.00..0.45: operator lifts empty tray out to left staging; 0.45..1.00: seats full tray
      if (p <= 0.15) {
        const s = p / 0.15;
        emptyGroup.position.set(x, lerp(y, y + 0.08, s), z);
      } else if (p <= 0.45) {
        const s = (p - 0.15) / 0.30;
        emptyGroup.position.set(lerp(x, x - 0.18, s), lerp(y + 0.08, carryY, s), lerp(z, carryZ, s));
      } else {
        emptyGroup.position.set(x - 0.18, carryY, carryZ);
      }
      emptyGroup.visible = true;

      if (p < 0.45) {
        spareGroup.position.set(x + 0.18, carryY, carryZ);
      } else if (p <= 0.85) {
        const s = (p - 0.45) / 0.40;
        spareGroup.position.set(lerp(x + 0.18, x, s), lerp(carryY, y + 0.08, s), lerp(carryZ, z, s));
      } else {
        const s = (p - 0.85) / 0.15;
        spareGroup.position.set(x, lerp(y + 0.08, y, s), z);
      }
      spareGroup.visible = true;
    } else {
      spareGroup.visible = true;
      spareGroup.position.set(x, y, z);
      if (walkOut && t <= walkOut.t1) {
        const p = clamp((t - walkOut.t0) / (walkOut.t1 - walkOut.t0), 0, 1);
        emptyGroup.visible = true;
        emptyGroup.position.set(lerp(x - 0.18, aisleX, p), carryY, lerp(carryZ, aisleCarryZ, p));
      } else {
        emptyGroup.visible = false;
      }
    }
  });
}

function poseParts(t) {
  const { S, parts, beltSpeed } = current();
  const [lo] = robotSample(t);
  const held = S.fHeld[lo];
  const timeline = partSchedule();
  urCover.visible = false;
  urScrew.visible = false;
  for (const part of parts) {
    const { k, end } = part;
    const { center, cover, screws } = partMeshes[k];
    const times = timeline[k];
    const grip = held.indexOf(k);
    center.visible = t >= part.release;
    center.quaternion.identity();
    if (grip !== -1) {
      placeOnTool(center, fanucScene.grips[grip].marker, 0);
    } else if (t < times.load) {
      center.position.set(ESC_X + beltSpeed * (t - part.release),
        CELL.infeed.top + housingHalf, CELL.infeed.z);
    } else if (t < times.release) {
      center.position.set(...CELL.fixture.pos);
      center.position.y += housingHalf;
    } else {
      center.position.set(...end.p);
      if (part.reject) {
        const fall = clamp((t - times.release) / (end.t - times.release), 0, 1);
        center.position.y = THREE.MathUtils.lerp(CELL.rejectBin.pos[1] + 0.04, end.p[1], fall ** 2);
      } else {
        center.position.x += CELL.outfeed.speed * (t - end.t);
        center.visible = center.position.x - CELL.housing[0] / 2 <= CELL.outfeed.x1;
      }
    }
    cover.visible = t >= times.cover;
    if (t >= times.acquire && t < times.cover) {
      urCover.visible = true;
      placeOnTool(urCover, urScene.tcp, COVER_H);
    }
    times.screws.forEach(({ i, approach, t1 }) => {
      screws[i].visible = t >= t1;
      if (t >= approach && t < t1) {
        urScrew.visible = true;
        placeOnTool(urScrew, urScene.tcp, screwHeadHeight);
      }
    });
  }
  poseTrays(t, timeline);
}

function poseAt(t) {
  const time = Math.max(0, t);
  const robotTime = Math.min(time, current().DURATION);
  poseFanuc(robotTime);
  poseUr(robotTime);
  poseParts(time);
}
