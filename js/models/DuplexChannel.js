// DuplexChannel.js — el medio físico para la pestaña de Piggybacking.
// A diferencia de Channel.js (que separa "datos van hacia abajo" / "ACK
// van hacia arriba" como dos flujos fijos), aquí AMBAS estaciones pueden
// enviar en cualquier dirección, y un mismo item puede llevar datos, un
// ACK, o los dos a la vez (`dataSeq` y `ackNum` no son mutuamente
// excluyentes) — eso es exactamente lo que hace posible el piggybacking.

let uid = 0;

export class DuplexChannel {
  constructor({ mode = 'full', baseDurationMs = 2000 } = {}) {
    this.mode = mode; // 'half' | 'full'
    this.baseDurationMs = baseDurationMs;
    this.items = new Map();
  }

  setMode(mode) {
    this.mode = mode;
  }

  setBaseDuration(ms) {
    this.baseDurationMs = ms;
  }

  // En half-duplex solo puede haber UN item viajando a la vez, sin
  // importar de qué estación venga ni qué lleve adentro.
  isBusy() {
    if (this.mode === 'full') return false;
    for (const item of this.items.values()) {
      if (!item.arrived && !item.lost) return true;
    }
    return false;
  }

  canSend() {
    return !this.isBusy();
  }

  // frame: { from: 'A' | 'B', dataSeq: number|null, ackNum: number|null }
  send(frame) {
    const item = {
      id: `f-${frame.from}-${++uid}`,
      from: frame.from,
      direction: frame.from === 'A' ? 'aToB' : 'bToA',
      dataSeq: frame.dataSeq ?? null,
      ackNum: frame.ackNum ?? null,
      progress: 0,
      durationMs: this.baseDurationMs,
      arrived: false,
      lost: false,
      createdAt: performance.now()
    };
    this.items.set(item.id, item);
    return item;
  }

  markLost(id) {
    const item = this.items.get(id);
    if (item && !item.arrived) {
      item.lost = true;
      return item;
    }
    return null;
  }

  tick(dtMs) {
    const arrived = [];
    const lost = [];
    for (const item of this.items.values()) {
      if (item.arrived || item.lost) continue;
      item.progress += dtMs / item.durationMs;
      if (item.progress >= 1) {
        item.progress = 1;
        item.arrived = true;
        arrived.push(item);
      }
    }
    for (const item of this.items.values()) {
      if (item.lost) lost.push(item);
    }
    return { arrived, lost };
  }

  remove(id) {
    this.items.delete(id);
  }

  clear() {
    this.items.clear();
  }
}
