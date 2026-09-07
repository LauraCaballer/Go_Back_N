// Simulation.js — the conductor. Owns the virtual clock, wires the
// Sender/Receiver/Channel models to the Timeline/Statistics services,
// and exposes the control surface the UI layer calls into.

import { Sender } from './models/Sender.js';
import { Receiver } from './models/Receiver.js';
import { Channel } from './models/Channel.js';
import { Timeline } from './services/Timeline.js';
import { Statistics } from './services/Statistics.js';
import { PacketStatus } from './models/Packet.js';

const TICK_MS = 50; // logic-loop resolution

export class Simulation {
  constructor(config, hooks = {}) {
    this.hooks = hooks; // { onTick, onTimelineEvent, onStatsChange, onPacketSelected }
    this.config = {
      totalPackets: 8,
      windowSize: 4,
      timeoutMs: 4000,
      mode: 'full',        // 'full' | 'half'
      speedMultiplier: 1,
      channelDurationMs: 2200,
      randomLossEnabled: false,
      randomLossRate: 0.15,
      ...config
    };

    this.clockMs = 0;
    this.running = false;
    this.autoSendEnabled = false;
    this.autoSendTimer = 0;
    this.autoSendIntervalMs = 900;
    this.pendingManualLoss = new Set(); // seq numbers flagged to drop on next send
    this.finished = false;

    this._buildModels();
    this._intervalHandle = null;
  }

  _buildModels() {
    const { totalPackets, windowSize, timeoutMs, mode, channelDurationMs } = this.config;

    this.timeline = new Timeline({
      onChange: (event) => this.hooks.onTimelineEvent && this.hooks.onTimelineEvent(event)
    });

    this.statistics = new Statistics({
      onChange: (stats) => this.hooks.onStatsChange && this.hooks.onStatsChange(stats)
    });

    this.channel = new Channel({ mode, baseDurationMs: channelDurationMs });

    this.sender = new Sender({
      totalPackets,
      windowSize,
      timeoutMs,
      onEvent: (type, data) => this._onSenderEvent(type, data)
    });

    this.receiver = new Receiver({
      onEvent: (type, data) => this._onReceiverEvent(type, data)
    });
  }

  // ---- lifecycle -------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    if (this.clockMs === 0) {
      this.timeline.add(0, 'info', null, 'Simulación iniciada');
    }
    this._intervalHandle = setInterval(() => this._tick(TICK_MS), TICK_MS);
  }

  pause() {
    this.running = false;
    if (this._intervalHandle) clearInterval(this._intervalHandle);
    this._intervalHandle = null;
  }

  reset(newConfig = {}) {
    this.pause();
    Object.assign(this.config, newConfig);
    this.clockMs = 0;
    this.autoSendEnabled = false;
    this.autoSendTimer = 0;
    this.pendingManualLoss.clear();
    this.finished = false;
    this._buildModels();
    this.timeline.add(0, 'info', null, 'Simulación reiniciada');
    this._emitTick();
  }

  // ---- config setters (safe to call mid-run) ----------------------------

  setWindowSize(size) {
    this.config.windowSize = size;
    this.sender.setWindowSize(size);
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

    const item = this.channel.sendData(packet, { speedMultiplier: this.config.speedMultiplier });
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
    const item = this.channel.sendData(packet, { speedMultiplier: this.config.speedMultiplier });
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
    if (type === 'packet-discarded') {
      this.timeline.add(
        this.clockMs,
        'discard',
        data.seq,
        `Receptor recibe Packet ${data.seq} fuera de orden (esperaba ${data.expected}) y lo descarta`
      );
    }
  }

  // ---- main loop -----------------------------------------------------

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

    if (this.sender.tickTimer(dt)) {
      this.statistics.recordTimeout();
      const range = this.sender.onTimeout();
      this.timeline.add(
        this.clockMs,
        'timeout',
        null,
        `Timeout de Packet ${this.sender.window.base} — retransmitiendo hasta ${this.sender.window.nextSeqNum - 1}`
      );
      range.forEach((packet) => this._retransmit(packet.seq));
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

    if (result.accepted) {
      packet.markReceived();
      this.statistics.recordReceived();
      this.timeline.add(this.clockMs, 'receive', item.seq, `Receptor recibe Packet ${item.seq}`);
    } else {
      packet.markOutOfOrder();
    }

    if (result.ackNum !== null && result.ackNum >= 0) {
      const ackItem = this.channel.sendAck(result.ackNum, {
        speedMultiplier: this.config.speedMultiplier,
        duplicate: !result.accepted
      });
      this.statistics.recordAckSent();
      this.timeline.add(
        this.clockMs,
        'ack-sent',
        result.ackNum,
        result.accepted
          ? `Receptor envía ACK ${result.ackNum}`
          : `Receptor reenvía ACK duplicado ${result.ackNum}`
      );
    }
  }

  _handleAckArrival(item) {
    this.channel.remove(item.id);
    this.statistics.recordAckReceived();
    const { moved } = this.sender.handleAck(item.seq);
    this.timeline.add(
      this.clockMs,
      'ack-received',
      item.seq,
      moved ? `Emisor recibe ACK ${item.seq} — ventana avanza` : `Emisor recibe ACK ${item.seq} (duplicado)`
    );
  }

  // ---- snapshot for the UI ---------------------------------------------

  _emitTick() {
    if (this.hooks.onTick) this.hooks.onTick(this.getState());
  }

  getState() {
    return {
      clockMs: this.clockMs,
      running: this.running,
      finished: this.finished,
      autoSendEnabled: this.autoSendEnabled,
      config: { ...this.config },
      window: {
        base: this.sender.window.base,
        nextSeqNum: this.sender.window.nextSeqNum,
        size: this.sender.window.size,
        timerProgress: this.sender.timerProgress(),
        timerActive: this.sender.timerActive
      },
      packets: this.sender.packets.map((p) => ({ seq: p.seq, status: p.status, attempts: p.attempts })),
      expectedSeqNum: this.receiver.expectedSeqNum,
      channelItems: Array.from(this.channel.items.values()).map((i) => ({ ...i })),
      pendingManualLoss: Array.from(this.pendingManualLoss)
    };
  }
}
