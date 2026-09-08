// Simulation.js — the conductor. Owns the virtual clock, wires the
// Sender/Receiver/Channel models to the Timeline/Statistics services,
// and exposes the control surface the UI layer calls into.

import { Sender } from './models/Sender.js';
import { Receiver } from './models/Receiver.js';
import { Channel } from './models/Channel.js';
import { Timeline } from './services/Timeline.js';
import { Statistics } from './services/Statistics.js';
import { PacketStatus } from './models/Packet.js';
import { SlidingWindow } from './models/SlidingWindow.js';

const TICK_MS = 50; // logic-loop resolution

export class Simulation {
  constructor(config, hooks = {}) {
    this.hooks = hooks; // { onTick, onTimelineEvent, onStatsChange, onPacketSelected }
    this.config = {
      totalPackets: 8,
      windowSize: 4,
      timeoutMs: 7500,
      mode: 'full',        // 'full' | 'half'
      policy: 'gbn',        // 'gbn' | 'sr' — política ARQ
      sequenceBits: 3,      // bits del número de secuencia (rango = 2^bits)
      speedMultiplier: 1,     // "cámara lenta/rápida": escala el reloj virtual completo por igual (timers Y canal), no cambia la relación RTT/timeout
      propagationDelayMs: 2000, // retardo de propagación de UN solo sentido, en ms virtuales. RTT aproximado (full-duplex) = 2 × esto
      randomLossEnabled: false,
      randomLossRate: 0.75,
      ...config
    };
    // La ventana pedida por el usuario puede exceder el máximo permitido
    // por la política + bits de secuencia; se clampa al construir.
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);

    this.clockMs = 0;
    this.running = false;
    this.autoSendEnabled = false;
    this.autoSendTimer = 0;
    this.autoSendIntervalMs = 900;
    this.pendingManualLoss = new Set(); // seq numbers flagged to drop on next send
    this.finished = false;
    this.pendingRetransmissions = [];
    this.retransmissionDelayMs = 300;
    this.retransmissionTimerMs = 0;

    this._buildModels();
    this._intervalHandle = null;
  }

  // ---- validación de ventana (regla clásica de ARQ) ---------------------

  maxWindowSize() {
    return SlidingWindow.maxWindowSize(this.config.policy, this.config.sequenceBits);
  }

  _clampWindowSize(size) {
    return Math.max(1, Math.min(size, this.maxWindowSize()));
  }

  _buildModels() {
    const { totalPackets, windowSize, timeoutMs, mode, propagationDelayMs, policy } = this.config;

    this.timeline = new Timeline({
      onChange: (event) => this.hooks.onTimelineEvent && this.hooks.onTimelineEvent(event)
    });

    this.statistics = new Statistics({
      onChange: (stats) => this.hooks.onStatsChange && this.hooks.onStatsChange(stats)
    });

    this.channel = new Channel({ mode, baseDurationMs: propagationDelayMs });

    this.sender = new Sender({
      totalPackets,
      windowSize,
      timeoutMs,
      policy,
      onEvent: (type, data) => this._onSenderEvent(type, data)
    });

    this.receiver = new Receiver({
      policy,
      windowSize,
      onEvent: (type, data) => this._onReceiverEvent(type, data)
    });
  }

  // ---- lifecycle -------------------------------------------------------

  start() {
  // Si ya existe un intervalo activo, no crear otro.
  if (this._intervalHandle !== null) {
    return;
  }

  this.running = true;

  if (this.clockMs === 0) {
    this.timeline.add(0, 'info', null, 'Simulación iniciada');
  }

  this._intervalHandle = setInterval(() => {
    if (!this.running) return;

    try {
      this._tick(TICK_MS);
    } catch (error) {
      console.error('Error en el ciclo de simulación:', error);

      // Evita que la interfaz quede en un estado falso.
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
    this.clockMs = 0;
    this.autoSendEnabled = false;
    this.autoSendTimer = 0;
    this.pendingManualLoss.clear();
    this.finished = false;
    this.pendingRetransmissions = [];
    this.retransmissionTimerMs = 0;
    this._buildModels();
    this.timeline.add(0, 'info', null, 'Simulación reiniciada');
    this._emitTick();
  }

  // ---- config setters (safe to call mid-run) ----------------------------

  setWindowSize(size) {
    const clamped = this._clampWindowSize(size);
    this.config.windowSize = clamped;
    this.sender.setWindowSize(clamped);
    this.receiver.setWindowSize(clamped);
    if (clamped !== size) {
      this.timeline.add(
        this.clockMs,
        'info',
        null,
        `⚠️ Ventana limitada a ${clamped} (máximo permitido con ${this.config.sequenceBits} bits de secuencia en ${this.config.policy === 'sr' ? 'Selective Repeat' : 'Go-Back-N'})`
      );
    }
    this._emitTick();
    return clamped;
  }

  // Cambiar de política ARQ reinicia la simulación: Go-Back-N y Selective
  // Repeat manejan timers, ACKs y buffers de forma incompatible entre sí,
  // así que no tiene sentido intentar "migrar" el estado a mitad de envío.
  setPolicy(policy) {
    this.pause();
    this.config.policy = policy;
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);
    this.clockMs = 0;
    this.channel.clear();
    this.pendingManualLoss.clear();
    this.pendingRetransmissions = [];
    this._buildModels();
    this.statistics.reset();
    this.timeline.reset();
    this.finished = false;
    this.timeline.add(
      0,
      'info',
      null,
      `Política cambiada a ${policy === 'sr' ? 'Selective Repeat (ACK selectivo, un timer por paquete)' : 'Go-Back-N (ACK acumulativo, un solo timer)'}`
    );
    this._emitTick();
  }

  setSequenceBits(bits) {
    this.pause();
    this.config.sequenceBits = bits;
    this.config.windowSize = this._clampWindowSize(this.config.windowSize);
    this.sender.setWindowSize(this.config.windowSize);
    this.receiver.setWindowSize(this.config.windowSize);
    this.timeline.add(
      this.clockMs,
      'info',
      null,
      `Bits de secuencia = ${bits} (rango 0..${2 ** bits - 1}) — ventana máx. ${this.maxWindowSize()}`
    );
    this._emitTick();
  }

  setPacketCount(total) {
    this.pause();
    this.config.totalPackets = total;
    this.clockMs = 0;
    this.channel.clear();
    this.sender.reset(total, this.config.windowSize);
    this.receiver.reset();
    this.statistics.reset();
    this.timeline.reset();
    this.finished = false;
    this.timeline.add(0, 'info', null, `Número de paquetes ajustado a ${total}`);
    this._emitTick();
  }

  setMode(mode) {
    this.config.mode = mode;
    this.channel.setMode(mode);
    this.timeline.add(this.clockMs, 'info', null, `Modo cambiado a ${mode === 'half' ? 'Half Duplex' : 'Full Duplex'}`);
    this._emitTick();
  }

  setTimeout(ms) {
    this.config.timeoutMs = ms;
    this.sender.setTimeout(ms);
    const rtt = this.config.propagationDelayMs * 2;
    if (rtt > ms) {
      this.timeline.add(
        this.clockMs,
        'info',
        null,
        `⚠️ Timeout (${ms}ms) por debajo del RTT estimado (${rtt}ms): habrá retransmisiones aunque nada se pierda`
      );
    }
  }

  setSpeed(multiplier) {
    // Cámara lenta/rápida: NO cambia el RTT ni el timeout en términos
    // relativos entre sí, solo qué tan rápido los ves transcurrir en
    // tiempo real. Se aplica de forma uniforme sobre dt en _tick().
    this.config.speedMultiplier = multiplier;
  }

  setPropagationDelay(ms) {
    this.config.propagationDelayMs = ms;
    this.channel.setBaseDuration(ms);
    const rtt = ms * 2;
    if (rtt > this.config.timeoutMs) {
      this.timeline.add(
        this.clockMs,
        'info',
        null,
        `⚠️ RTT estimado (${rtt}ms) supera el timeout (${this.config.timeoutMs}ms): habrá retransmisiones aunque nada se pierda`
      );
    }
    this._emitTick();
  }

  toggleRandomLoss(enabled) {
    this.config.randomLossEnabled = enabled;
  }

  setRandomLossRate(rate) {
    this.config.randomLossRate = rate;
  }

  toggleAutoSend(enabled) {
    this.autoSendEnabled = enabled;
    this.autoSendTimer = 0;
    if (enabled && !this.running) this.start();
  }

  // ---- manual actions ----------------------------------------------------

  sendNext() {
    const seq = this.sender.nextSeqToSend();
    if (seq === null) return false;
    return this._doSend(seq);
  }

  sendWindow() {
    let sentAny = false;
    while (this.sender.canSendNext()) {
      const seq = this.sender.nextSeqToSend();
      if (!this._doSend(seq)) break; // channel busy (half duplex)
      sentAny = true;
    }
    return sentAny;
  }

  // Flag a specific, not-yet-sent sequence number to be dropped the
  // moment it's transmitted ("Simular pérdida" pre-selection).
  queueManualLoss(seq) {
    this.pendingManualLoss.add(seq);
  }

  // Drop a packet that is already travelling through the channel.
  loseInFlightItem(itemId) {
    const item = this.channel.markLost(itemId);
    if (!item) return false;
    this._resolveLoss(item);
    return true;
  }

  forceTimeout() {
    if (this.config.policy === 'gbn') {
      if (this.sender.window.base >= this.sender.window.nextSeqNum) return false;
      this.sender.stopTimer();
      const range = this.sender.onTimeout();
      this.statistics.recordTimeout();
      this.timeline.add(
        this.clockMs,
        'timeout',
        null,
        `Timeout forzado de Packet ${this.sender.window.base} — retransmitiendo hasta ${this.sender.window.nextSeqNum - 1}`
      );
      range.forEach((packet) => this._retransmit(packet.seq));
      this._emitTick();
      return true;
    }

    // Selective Repeat: fuerza solo el timer más próximo a vencer.
    const { active, seq } = this.sender.soonestTimerProgress();
    if (!active || seq === null) return false;
    const packet = this.sender.onTimeoutSR(seq);
    this.statistics.recordTimeout();
    this.timeline.add(
      this.clockMs,
      'timeout',
      seq,
      `Timeout forzado de Packet ${seq} (Selective Repeat) — se retransmite solo ese paquete`
    );
    if (packet) this._retransmit(seq);
    this._emitTick();
    return true;
  }

  selectPacket(seq) {
    const packet = this.sender.packets[seq];
    if (this.hooks.onPacketSelected) this.hooks.onPacketSelected(packet);
  }

  // ---- internal: sending / receiving / losing ---------------------------

  _doSend(seq) {
    if (!this.channel.canSend('down')) return false;
    const packet = this.sender.packets[seq];

    let willBeLost = false;
    if (this.pendingManualLoss.has(seq)) {
      willBeLost = true;
      this.pendingManualLoss.delete(seq);
    } else if (this.config.randomLossEnabled && Math.random() < this.config.randomLossRate) {
      willBeLost = true;
    }

    const item = this.channel.sendData(packet);
    item.willBeLost = willBeLost;

    this.sender.registerSent(seq);
    this.sender.markInTransit(seq);
    this.statistics.recordSent(seq);
    this.timeline.add(
      this.clockMs,
      'send',
      seq,
      packet.attempts > 1 ? `Emisor retransmite Packet ${seq}` : `Emisor envía Packet ${seq}`
    );
    this._emitTick();
    return true;
  }

  _retransmit(seq) {
    if (!this.channel.canSend('down')) {
      // In half duplex we simply queue: nothing else to do here since
      // the auto-loop / next manual action will keep draining base..next.
      return false;
    }
    const packet = this.sender.packets[seq];
    let willBeLost = false;
    if (this.pendingManualLoss.has(seq)) {
      willBeLost = true;
      this.pendingManualLoss.delete(seq);
    } else if (this.config.randomLossEnabled && Math.random() < this.config.randomLossRate) {
      willBeLost = true;
    }
    const item = this.channel.sendData(packet);
    item.willBeLost = willBeLost;
    packet.markSent();
    packet.status = PacketStatus.RETRANSMITTED;
    this.statistics.recordSent(seq);
    this.timeline.add(this.clockMs, 'retransmit', seq, `Emisor retransmite Packet ${seq}`);
    return true;
  }

  _resolveLoss(item) {
    this.channel.remove(item.id);
    if (item.kind === 'data') {
      const packet = this.sender.packets[item.seq];
      packet.markLost();
      this.statistics.recordLost();
      this.timeline.add(this.clockMs, 'loss', item.seq, `Packet ${item.seq} perdido en el canal`);
    } else {
      this.timeline.add(this.clockMs, 'loss', item.seq, `ACK ${item.seq} perdido en el canal`);
    }
    this._emitTick();
  }

  _onSenderEvent(type, data) {
    // Reserved for future fine-grained hooks; timeline entries for the
    // common cases are already written by the call sites above.
  }

  _onReceiverEvent(type, data) {
    // Los eventos 'packet-discarded' / 'packet-accepted' / 'packet-duplicate'
    // ya se registran directamente en _handleDataArrival, con el detalle
    // correcto según la política (GBN vs SR). Este hook queda disponible
    // para instrumentación futura sin duplicar entradas en la línea de tiempo.
  }

  // ---- main loop -----------------------------------------------------

  _processRetransmissions(dt) {
  if (this.pendingRetransmissions.length === 0) {
    this.retransmissionTimerMs = 0;
    return;
  }

  this.retransmissionTimerMs -= dt;

  if (this.retransmissionTimerMs > 0) {
    return;
  }

  const seq = this.pendingRetransmissions.shift();

  if (seq !== undefined) {
    this._retransmit(seq);
  }

  if (this.pendingRetransmissions.length > 0) {
    this.retransmissionTimerMs = this.retransmissionDelayMs;
  } else {
    this.retransmissionTimerMs = 0;
  }
}

  _tick(dtRealMs) {
    if (!this.running) return;
    const dt = dtRealMs * this.config.speedMultiplier;
    this.clockMs += dt;

    // Auto-send: keep the window full for the user automatically.
    if (this.autoSendEnabled && !this.finished) {
      this.autoSendTimer -= dt;
      if (this.autoSendTimer <= 0) {
        this.autoSendTimer = this.autoSendIntervalMs;
        if (this.sender.canSendNext()) this._doSend(this.sender.nextSeqToSend());
      }
    }

    // Resolve any items doomed to be lost once they're halfway across.
    for (const item of this.channel.items.values()) {
      if (item.willBeLost && !item.lost && !item.arrived && item.progress >= 0.5) {
        this.channel.markLost(item.id);
        this._resolveLoss(item);
      }
    }

    const { arrivedData, arrivedAcks } = this.channel.tick(dt);

    arrivedData.forEach((item) => this._handleDataArrival(item));
    arrivedAcks.forEach((item) => this._handleAckArrival(item));
    // Retransmisiones Go-Back-N escalonadas.
    this._processRetransmissions(dt);

    const expiredSeqs = this.sender.advanceTimers(dt);
    if (expiredSeqs.length > 0) {
      if (this.config.policy === 'gbn') {
        this.statistics.recordTimeout();

        const base = this.sender.window.base;
        const upTo = this.sender.window.nextSeqNum - 1;
        const range = this.sender.onTimeout(); // reinicia el timer único de la base

        this.timeline.add(
          this.clockMs,
          'timeout',
          null,
          `Timeout de Packet ${base} — retransmitiendo hasta ${upTo}`
        );

        // Cancelar cualquier cola anterior (GBN reemplaza todo el rango).
        this.pendingRetransmissions = [];
        range.forEach((packet) => {
          this.pendingRetransmissions.push(packet.seq);
        });
        this.retransmissionTimerMs = 0;
      } else {
        // Selective Repeat: cada paquete vencido se retransmite de forma
        // INDEPENDIENTE — no se tocan los timers de los demás paquetes.
        expiredSeqs.forEach((seq) => {
          this.statistics.recordTimeout();
          const packet = this.sender.onTimeoutSR(seq);
          this.timeline.add(
            this.clockMs,
            'timeout',
            seq,
            `Timeout de Packet ${seq} (Selective Repeat) — se retransmite solo ese paquete`
          );
          if (packet) this.pendingRetransmissions.push(seq);
        });
      }
    }

    if (this.sender.isFinished() && !this.finished) {
      this.finished = true;
      this.autoSendEnabled = false;
      this.timeline.add(this.clockMs, 'info', null, 'Todos los paquetes fueron confirmados. Simulación completa.');
    }

    this._emitTick();
  }

  _handleDataArrival(item) {
    this.channel.remove(item.id);
    const packet = this.sender.packets[item.seq];
    const result = this.receiver.handlePacket(item.seq);
    const isSR = this.config.policy === 'sr';

    if (result.accepted) {
      packet.markReceived();
      this.statistics.recordReceived();
      this.timeline.add(
        this.clockMs,
        'receive',
        item.seq,
        isSR
          ? `Receptor recibe y guarda Packet ${item.seq} (dentro de la ventana de recepción)`
          : `Receptor recibe Packet ${item.seq}`
      );
    } else if (isSR && result.duplicate) {
      packet.markOutOfOrder();
      this.timeline.add(
        this.clockMs,
        'discard',
        item.seq,
        `Receptor recibe Packet ${item.seq} duplicado (ya entregado antes) — reenvía su ACK`
      );
    } else {
      packet.markOutOfOrder();
      this.timeline.add(
        this.clockMs,
        'discard',
        item.seq,
        isSR
          ? `Receptor recibe Packet ${item.seq} fuera de la ventana de recepción y lo descarta`
          : `Receptor recibe Packet ${item.seq} fuera de orden (esperaba ${this.receiver.expectedSeqNum}) y lo descarta`
      );
    }

    if (result.ackNum !== null && result.ackNum >= 0) {
      this.channel.sendAck(result.ackNum, { duplicate: !result.accepted });
      this.statistics.recordAckSent();
      this.timeline.add(
        this.clockMs,
        'ack-sent',
        result.ackNum,
        isSR
          ? `Receptor envía ACK selectivo ${result.ackNum} (confirma solo ese paquete)`
          : result.accepted
            ? `Receptor envía ACK ${result.ackNum}`
            : `Receptor reenvía ACK duplicado ${result.ackNum}`
      );
    }
  }

  _handleAckArrival(item) {
    this.channel.remove(item.id);
    this.statistics.recordAckReceived();
    const { moved } = this.sender.handleAck(item.seq);
    const isSR = this.config.policy === 'sr';
    this.timeline.add(
      this.clockMs,
      'ack-received',
      item.seq,
      moved
        ? `Emisor recibe ACK ${item.seq} — ventana avanza`
        : isSR
          ? `Emisor recibe ACK ${item.seq} (confirma ese paquete, pero la base sigue esperando uno anterior)`
          : `Emisor recibe ACK ${item.seq} (duplicado)`
    );
  }

  // ---- snapshot for the UI ---------------------------------------------

  _emitTick() {
    if (this.hooks.onTick) this.hooks.onTick(this.getState());
  }

  getState() {
    const isSR = this.config.policy === 'sr';
    // Timer unificado para la UI: en GBN es el único timer de la base;
    // en SR es el timer más próximo a vencer (puede haber varios a la vez).
    const timerInfo = isSR
      ? this.sender.soonestTimerProgress()
      : { active: this.sender.timerActive, progress: this.sender.timerProgress(), seq: this.sender.window.base };

    return {
      clockMs: this.clockMs,
      running: this.running,
      finished: this.finished,
      autoSendEnabled: this.autoSendEnabled,
      config: { ...this.config },
      maxWindowSize: this.maxWindowSize(),
      activeTimerCount: isSR ? this.sender.timers.size : (this.sender.timerActive ? 1 : 0),
      window: {
        base: this.sender.window.base,
        nextSeqNum: this.sender.window.nextSeqNum,
        size: this.sender.window.size,
        timerProgress: timerInfo.progress,
        timerActive: timerInfo.active,
        timerSeq: timerInfo.seq
      },
      packets: this.sender.packets.map((p) => ({ seq: p.seq, status: p.status, attempts: p.attempts })),
      expectedSeqNum: this.receiver.expectedSeqNum,
      channelItems: Array.from(this.channel.items.values()).map((i) => ({ ...i })),
      pendingManualLoss: Array.from(this.pendingManualLoss)
    };
  }
}
