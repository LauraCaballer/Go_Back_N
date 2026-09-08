// PiggybackSimulation.js — el conductor de la pestaña "Conversación
// (Piggybacking)". Es hermano de Simulation.js (misma idea de reloj
// virtual + hooks hacia la UI) pero orquesta DOS Station en vez de un
// Sender/Receiver fijo, porque aquí ambos lados hablan y confirman al
// mismo tiempo.

import { Station } from './models/Station.js';
import { DuplexChannel } from './models/DuplexChannel.js';
import { Timeline } from './services/Timeline.js';
import { SlidingWindow } from './models/SlidingWindow.js';
import { PacketStatus } from './models/Packet.js';

const TICK_MS = 50;

export class PiggybackSimulation {
  constructor(config, hooks = {}) {
    this.hooks = hooks; // { onTick, onTimelineEvent }
    this.config = {
      totalPackets: 6,
      windowSize: 4,
      timeoutMs: 7500,
      policy: 'gbn',
      sequenceBits: 3,
      mode: 'full', // 'full' | 'half'
      propagationDelayMs: 2000,
      ackHoldMs: 900, // cuánto espera una estación antes de mandar un ACK puro
      speedMultiplier: 1,
      randomLossEnabled: false,
      randomLossRate: 0.5,
      aAutoSend: false,
      bAutoSend: false,
      ...config
    };
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);

    this.clockMs = 0;
    this.running = false;
    this.pendingManualLoss = new Set(); // ids "A:seq" / "B:seq" marcados para perderse al enviarse
    this.finished = false;
    this.retransmissionDelayMs = 300;
    this.autoSendIntervalMs = 900;

    this.stats = {
      sentA: 0,
      sentB: 0,
      received: 0,
      lost: 0,
      timeouts: 0,
      acksNaked: 0,
      acksPiggybacked: 0
    };

    this._buildModels();
    this._intervalHandle = null;
  }

  maxWindowSize() {
    return SlidingWindow.maxWindowSize(this.config.policy, this.config.sequenceBits);
  }

  _clampWindowSize(size) {
    return Math.max(1, Math.min(size, this.maxWindowSize()));
  }

  _buildModels() {
    const { totalPackets, windowSize, timeoutMs, policy, sequenceBits, ackHoldMs, mode, propagationDelayMs } =
      this.config;

    this.timeline = new Timeline({
      onChange: (event) => this.hooks.onTimelineEvent && this.hooks.onTimelineEvent(event)
    });

    this.channel = new DuplexChannel({ mode, baseDurationMs: propagationDelayMs });

    this.stationA = new Station({
      id: 'A',
      totalPackets,
      windowSize,
      timeoutMs,
      policy,
      sequenceBits,
      ackHoldMs,
      onEvent: () => {}
    });

    this.stationB = new Station({
      id: 'B',
      totalPackets,
      windowSize,
      timeoutMs,
      policy,
      sequenceBits,
      ackHoldMs,
      onEvent: () => {}
    });
  }

  _other(id) {
    return id === 'A' ? this.stationB : this.stationA;
  }

  _station(id) {
    return id === 'A' ? this.stationA : this.stationB;
  }

  // ---- lifecycle -----------------------------------------------------

  start() {
    if (this._intervalHandle !== null) return;
    this.running = true;
    if (this.clockMs === 0) this.timeline.add(0, 'info', null, 'Conversación iniciada');

    this._intervalHandle = setInterval(() => {
      if (!this.running) return;
      try {
        this._tick(TICK_MS);
      } catch (error) {
        console.error('Error en el ciclo de la simulación de piggybacking:', error);
        this.pause();
      }
    }, TICK_MS);
  }

  pause() {
    this.running = false;
    if (this._intervalHandle !== null) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
    this._emitTick();
  }

  reset(newConfig = {}) {
    this.pause();
    Object.assign(this.config, newConfig);
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);
    this.clockMs = 0;
    this.pendingManualLoss.clear();
    this.finished = false;
    this.stats = { sentA: 0, sentB: 0, received: 0, lost: 0, timeouts: 0, acksNaked: 0, acksPiggybacked: 0 };
    this._buildModels();
    this.timeline.add(0, 'info', null, 'Conversación reiniciada');
    this._emitTick();
  }

  // ---- config setters --------------------------------------------------

  setWindowSize(size) {
    const clamped = this._clampWindowSize(size);
    this.config.windowSize = clamped;
    this.stationA.setWindowSize(clamped);
    this.stationB.setWindowSize(clamped);
    if (clamped !== size) {
      this.timeline.add(
        this.clockMs,
        'info',
        null,
        `⚠️ Ventana limitada a ${clamped} (máximo con ${this.config.sequenceBits} bits en ${this.config.policy === 'sr' ? 'Selective Repeat' : 'Go-Back-N'})`
      );
    }
    this._emitTick();
    return clamped;
  }

  setPolicy(policy) {
    this.pause();
    this.config.policy = policy;
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);
    this.clockMs = 0;
    this.pendingManualLoss.clear();
    this._buildModels();
    this.finished = false;
    this.timeline.add(0, 'info', null, `Política cambiada a ${policy === 'sr' ? 'Selective Repeat' : 'Go-Back-N'}`);
    this._emitTick();
  }

  setSequenceBits(bits) {
    this.pause();
    this.config.sequenceBits = bits;
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);
    this.stationA.setWindowSize(this.config.windowSize);
    this.stationB.setWindowSize(this.config.windowSize);
    this.timeline.add(this.clockMs, 'info', null, `Bits de secuencia = ${bits} — ventana máx. ${this.maxWindowSize()}`);
    this._emitTick();
  }

  setTimeout(ms) {
    this.config.timeoutMs = ms;
    this.stationA.setTimeout(ms);
    this.stationB.setTimeout(ms);
    this._warnIfRttExceedsTimeout();
  }

  setPropagationDelay(ms) {
    this.config.propagationDelayMs = ms;
    this.channel.setBaseDuration(ms);
    this._warnIfRttExceedsTimeout();
    this._emitTick();
  }

  _warnIfRttExceedsTimeout() {
    const rtt = this.config.propagationDelayMs * 2;
    if (rtt > this.config.timeoutMs) {
      this.timeline.add(
        this.clockMs,
        'info',
        null,
        `⚠️ RTT estimado (${rtt}ms) supera el timeout (${this.config.timeoutMs}ms): habrá retransmisiones aunque nada se pierda`
      );
    }
  }

  setAckHold(ms) {
    this.config.ackHoldMs = ms;
    this.stationA.setAckHold(ms);
    this.stationB.setAckHold(ms);
    this._emitTick();
  }

  setMode(mode) {
    this.config.mode = mode;
    this.channel.setMode(mode);
    this.timeline.add(this.clockMs, 'info', null, `Modo cambiado a ${mode === 'half' ? 'Half Duplex' : 'Full Duplex'}`);
    this._emitTick();
  }

  setSpeed(multiplier) {
    this.config.speedMultiplier = multiplier;
  }

  toggleRandomLoss(enabled) {
    this.config.randomLossEnabled = enabled;
  }

  setRandomLossRate(rate) {
    this.config.randomLossRate = rate;
  }

  setPacketCount(total) {
    this.pause();
    this.config.totalPackets = total;
    this.clockMs = 0;
    this.channel.clear();
    this.stationA.reset(total, this.config.windowSize);
    this.stationB.reset(total, this.config.windowSize);
    this.finished = false;
    this.timeline.add(0, 'info', null, `Número de paquetes ajustado a ${total} por estación`);
    this._emitTick();
  }

  toggleAutoSend(id, enabled) {
    const station = this._station(id);
    station.autoSendEnabled = enabled;
    station.autoSendTimer = 0;
    if (enabled && !this.running) this.start();
    this._emitTick();
  }

  // ---- acciones manuales ------------------------------------------------

  sendNext(id) {
    const station = this._station(id);
    const seq = station.sender.nextSeqToSend();
    if (seq === null) return false;
    return this._doSend(station, id, seq);
  }

  queueManualLoss(id, seq) {
    this.pendingManualLoss.add(`${id}:${seq}`);
  }

  loseInFlightItem(itemId) {
    const item = this.channel.markLost(itemId);
    if (!item) return false;
    this._resolveLoss(item);
    return true;
  }

  forceTimeout(id) {
    const station = this._station(id);
    if (this.config.policy === 'gbn') {
      if (station.sender.window.base >= station.sender.window.nextSeqNum) return false;
      station.sender.stopTimer();
      const range = station.sender.onTimeout();
      this.stats.timeouts += 1;
      this.timeline.add(this.clockMs, 'timeout', null, `Timeout forzado en ${id}: Packet ${station.sender.window.base}`);
      range.forEach((packet) => this._retransmit(station, id, packet.seq));
      this._emitTick();
      return true;
    }
    const { active, seq } = station.sender.soonestTimerProgress();
    if (!active || seq === null) return false;
    const packet = station.sender.onTimeoutSR(seq);
    this.stats.timeouts += 1;
    this.timeline.add(this.clockMs, 'timeout', seq, `Timeout forzado en ${id}: Packet ${seq} (SR)`);
    if (packet) this._retransmit(station, id, seq);
    this._emitTick();
    return true;
  }

  // ---- envío / retransmisión (con piggyback oportunista) -----------------

  _doSend(station, id, seq) {
    if (!this.channel.canSend()) return false;
    const packet = station.sender.packets[seq];

    let willBeLost = false;
    const lossKey = `${id}:${seq}`;
    if (this.pendingManualLoss.has(lossKey)) {
      willBeLost = true;
      this.pendingManualLoss.delete(lossKey);
    } else if (this.config.randomLossEnabled && Math.random() < this.config.randomLossRate) {
      willBeLost = true;
    }

    // Oportunidad de piggyback: si hay un ACK esperando salir, se monta
    // en este mismo frame en vez de viajar aparte.
    const ackEntry = station.hasPendingAck() ? station.popAck() : null;
    const ackToAttach = ackEntry ? ackEntry.ackNum : null;

    const item = this.channel.send({ from: id, dataSeq: seq, ackNum: ackToAttach });
    item.willBeLost = willBeLost;

    station.sender.registerSent(seq);
    station.sender.markInTransit(seq);
    this.stats[id === 'A' ? 'sentA' : 'sentB'] += 1;

    if (ackToAttach !== null) {
      this.stats.acksPiggybacked += 1;
      this.timeline.add(
        this.clockMs,
        'send',
        seq,
        `${id} envía Packet ${seq} + ACK ${ackToAttach} montado (piggyback)`
      );
    } else {
      this.timeline.add(
        this.clockMs,
        'send',
        seq,
        packet.attempts > 1 ? `${id} retransmite Packet ${seq}` : `${id} envía Packet ${seq}`
      );
    }
    this._emitTick();
    return true;
  }

  _retransmit(station, id, seq) {
    if (!this.channel.canSend()) return false;
    const packet = station.sender.packets[seq];

    let willBeLost = false;
    const lossKey = `${id}:${seq}`;
    if (this.pendingManualLoss.has(lossKey)) {
      willBeLost = true;
      this.pendingManualLoss.delete(lossKey);
    } else if (this.config.randomLossEnabled && Math.random() < this.config.randomLossRate) {
      willBeLost = true;
    }

    const ackEntry = station.hasPendingAck() ? station.popAck() : null;
    const ackToAttach = ackEntry ? ackEntry.ackNum : null;

    const item = this.channel.send({ from: id, dataSeq: seq, ackNum: ackToAttach });
    item.willBeLost = willBeLost;

    packet.markSent();
    packet.status = PacketStatus.RETRANSMITTED;
    this.stats[id === 'A' ? 'sentA' : 'sentB'] += 1;
    if (ackToAttach !== null) this.stats.acksPiggybacked += 1;

    this.timeline.add(
      this.clockMs,
      'retransmit',
      seq,
      ackToAttach !== null
        ? `${id} retransmite Packet ${seq} + ACK ${ackToAttach} montado`
        : `${id} retransmite Packet ${seq}`
    );
    return true;
  }

  // ACK puro: se manda porque se acabó el tiempo de espera sin oportunidad
  // de montarlo sobre un dato propio.
  _sendNakedAck(station, id) {
    if (!this.channel.canSend() || !station.hasPendingAck()) return false;
    const { ackNum } = station.popAck();
    this.channel.send({ from: id, dataSeq: null, ackNum });
    this.stats.acksNaked += 1;
    this.timeline.add(this.clockMs, 'ack-sent', ackNum, `${id} envía ACK ${ackNum} solo (naked, se acabó la espera)`);
    this._emitTick();
    return true;
  }

  _resolveLoss(item) {
    this.channel.remove(item.id);
    this.stats.lost += 1;
    const originStation = this._station(item.from);
    if (item.dataSeq !== null) {
      originStation.sender.packets[item.dataSeq]?.markLost();
    }
    const label =
      item.dataSeq !== null && item.ackNum !== null
        ? `Packet ${item.dataSeq} + ACK ${item.ackNum} (combinado)`
        : item.dataSeq !== null
          ? `Packet ${item.dataSeq}`
          : `ACK ${item.ackNum}`;
    this.timeline.add(this.clockMs, 'loss', null, `${label} de ${item.from} se perdió en el canal`);
    this._emitTick();
  }

  // ---- llegada de un frame (datos y/o ACK) -------------------------------

  _handleArrival(item) {
    this.channel.remove(item.id);
    const originStation = this._station(item.from);
    const destStation = this._other(item.from);
    const destId = item.from === 'A' ? 'B' : 'A';

    if (item.dataSeq !== null) {
      const result = destStation.receiver.handlePacket(item.dataSeq);
      const packet = originStation.sender.packets[item.dataSeq];
      if (result.accepted) {
        packet.markReceived();
        this.stats.received += 1;
        this.timeline.add(this.clockMs, 'receive', item.dataSeq, `${destId} recibe Packet ${item.dataSeq} de ${item.from}`);
      } else {
        packet.markOutOfOrder();
        this.timeline.add(
          this.clockMs,
          'discard',
          item.dataSeq,
          `${destId} descarta Packet ${item.dataSeq} de ${item.from} (fuera de orden/ventana)`
        );
      }
      if (result.ackNum !== null && result.ackNum >= 0) {
        // Este ACK es responsabilidad de destStation devolverlo — entra a
        // SU cola, esperando piggyback o naked, no se manda de inmediato.
        destStation.queueAck(result.ackNum);
      }
    }

    if (item.ackNum !== null) {
      const { moved } = destStation.sender.handleAck(item.ackNum);
      this.timeline.add(
        this.clockMs,
        'ack-received',
        item.ackNum,
        `${destId} recibe ${item.dataSeq !== null ? 'ACK montado' : 'ACK'} ${item.ackNum} de ${item.from}${moved ? ' — ventana avanza' : ''}`
      );
    }
  }

  // ---- retransmisiones escalonadas por estación --------------------------

  _processStationRetransmissions(station, id, dt) {
    if (station.pendingRetransmissions.length === 0) {
      station.retransmissionTimerMs = 0;
      return;
    }
    station.retransmissionTimerMs -= dt;
    if (station.retransmissionTimerMs > 0) return;

    const seq = station.pendingRetransmissions.shift();
    if (seq !== undefined) this._retransmit(station, id, seq);

    station.retransmissionTimerMs = station.pendingRetransmissions.length > 0 ? this.retransmissionDelayMs : 0;
  }

  _advanceStationTimers(station, id, dt) {
    const expired = station.sender.advanceTimers(dt);
    if (expired.length === 0) return;

    if (this.config.policy === 'gbn') {
      const base = station.sender.window.base;
      const upTo = station.sender.window.nextSeqNum - 1;
      const range = station.sender.onTimeout();
      this.stats.timeouts += 1;
      this.timeline.add(this.clockMs, 'timeout', null, `Timeout en ${id}: Packet ${base} — retransmitiendo hasta ${upTo}`);
      station.pendingRetransmissions = range.map((p) => p.seq);
      station.retransmissionTimerMs = 0;
    } else {
      expired.forEach((seq) => {
        this.stats.timeouts += 1;
        const packet = station.sender.onTimeoutSR(seq);
        this.timeline.add(this.clockMs, 'timeout', seq, `Timeout en ${id}: Packet ${seq} (SR) — solo ese paquete`);
        if (packet) station.pendingRetransmissions.push(seq);
      });
    }
  }

  // ---- bucle principal ---------------------------------------------------

  _tick(dtRealMs) {
    if (!this.running) return;
    const dt = dtRealMs * this.config.speedMultiplier;
    this.clockMs += dt;

    [this.stationA, this.stationB].forEach((station) => {
      const id = station.id;

      // Auto-send: si esta estación tiene algo que mandar, lo manda
      // (y de paso monta cualquier ACK que tuviera pendiente).
      if (station.autoSendEnabled && !this.finished) {
        station.autoSendTimer -= dt;
        if (station.autoSendTimer <= 0) {
          station.autoSendTimer = this.autoSendIntervalMs;
          if (station.sender.canSendNext()) this._doSend(station, id, station.sender.nextSeqToSend());
        }
      }

      // Envejecer los ACKs pendientes de esta estación.
      station.advanceAckHold(dt);

      // Si el ACK más viejo se pasó del tiempo de espera y esta estación
      // no logró montarlo sobre un dato propio, se manda solo.
      if (station.hasPendingAck() && station.oldestPendingAckAge() >= station.ackHoldMs) {
        this._sendNakedAck(station, id);
      }
    });

    // Resolver pérdidas "programadas" a medio camino (igual criterio que
    // en Simulation.js: se ve venir la pérdida en vez de que desaparezca
    // de golpe al llegar al final).
    for (const item of this.channel.items.values()) {
      if (item.willBeLost && !item.lost && !item.arrived && item.progress >= 0.5) {
        this.channel.markLost(item.id);
        this._resolveLoss(item);
      }
    }

    const { arrived } = this.channel.tick(dt);
    arrived.forEach((item) => this._handleArrival(item));

    this._processStationRetransmissions(this.stationA, 'A', dt);
    this._processStationRetransmissions(this.stationB, 'B', dt);

    this._advanceStationTimers(this.stationA, 'A', dt);
    this._advanceStationTimers(this.stationB, 'B', dt);

    if (this.stationA.isFinished() && this.stationB.isFinished() && !this.finished) {
      this.finished = true;
      this.stationA.autoSendEnabled = false;
      this.stationB.autoSendEnabled = false;
      this.timeline.add(this.clockMs, 'info', null, 'Ambas estaciones confirmaron todos sus paquetes. Conversación completa.');
    }

    this._emitTick();
  }

  // ---- snapshot para la UI -----------------------------------------------

  _emitTick() {
    if (this.hooks.onTick) this.hooks.onTick(this.getState());
  }

  _stationSnapshot(station) {
    const isSR = this.config.policy === 'sr';
    const timerInfo = isSR
      ? station.sender.soonestTimerProgress()
      : { active: station.sender.timerActive, progress: station.sender.timerProgress(), seq: station.sender.window.base };

    return {
      window: {
        base: station.sender.window.base,
        nextSeqNum: station.sender.window.nextSeqNum,
        size: station.sender.window.size,
        timerProgress: timerInfo.progress,
        timerActive: timerInfo.active,
        timerSeq: timerInfo.seq
      },
      packets: station.sender.packets.map((p) => ({ seq: p.seq, status: p.status, attempts: p.attempts })),
      expectedSeqNum: station.receiver.expectedSeqNum,
      pendingAckCount: station.pendingAcks.length,
      oldestPendingAckAge: station.oldestPendingAckAge(),
      autoSendEnabled: station.autoSendEnabled,
      finished: station.isFinished()
    };
  }

  getState() {
    const acksTotal = this.stats.acksNaked + this.stats.acksPiggybacked;
    return {
      clockMs: this.clockMs,
      running: this.running,
      finished: this.finished,
      config: { ...this.config },
      maxWindowSize: this.maxWindowSize(),
      stationA: this._stationSnapshot(this.stationA),
      stationB: this._stationSnapshot(this.stationB),
      channelItems: Array.from(this.channel.items.values()).map((i) => ({ ...i })),
      stats: {
        ...this.stats,
        piggybackRate: acksTotal === 0 ? 0 : Math.round((this.stats.acksPiggybacked / acksTotal) * 100)
      }
    };
  }
}
