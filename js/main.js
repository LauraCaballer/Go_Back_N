import { Simulation } from './Simulation.js';
import {
  renderPacketTrack,
  renderWindowFrame,
  renderChannelItems,
  renderTimeline,
  renderStats,
  renderPacketDetail,
  formatClock,
  renderGBNDiagram,
  resetGBNDiagram 
} from './ui/Renderer.js';

import { Evaluation } from './services/Evaluation.js';

import {
  renderEvaluationQuestion,
  renderEvaluationResult,
  renderEvaluationFinal
} from './ui/EvaluationRenderer.js';

// ---- DOM references -----------------------------------------------------

const $ = (id) => document.getElementById(id);

const els = {
  startBtn: $('startBtn'),
  pauseBtn: $('pauseBtn'),
  resetBtn: $('resetBtn'),
  modeFullBtn: $('modeFullBtn'),
  modeHalfBtn: $('modeHalfBtn'),
  gbnSvg: document.getElementById('gbnSvg'),

  windowSizeInput: $('windowSizeInput'),
  windowSizeVal: $('windowSizeVal'),
  windowLimitHint: $('windowLimitHint'),
  policyGbnBtn: $('policyGbnBtn'),
  policySrBtn: $('policySrBtn'),
  sequenceBitsInput: $('sequenceBitsInput'),
  sequenceBitsVal: $('sequenceBitsVal'),
  packetCountInput: $('packetCountInput'),
  packetCountVal: $('packetCountVal'),
  timeoutInput: $('timeoutInput'),
  timeoutVal: $('timeoutVal'),
  propDelayInput: $('propDelayInput'),
  propDelayVal: $('propDelayVal'),
  rttHint: $('rttHint'),
  speedInput: $('speedInput'),
  speedVal: $('speedVal'),
  randomLossInput: $('randomLossInput'),
  randomLossRateField: $('randomLossRateField'),
  randomLossRateInput: $('randomLossRateInput'),
  randomLossRateVal: $('randomLossRateVal'),

  sendNextBtn: $('sendNextBtn'),
  sendWindowBtn: $('sendWindowBtn'),
  autoSendBtn: $('autoSendBtn'),
  loseSelectedBtn: $('loseSelectedBtn'),
  forceTimeoutBtn: $('forceTimeoutBtn'),

  packetDetail: $('packetDetail'),
  pd: {
    seq: $('pdSeq'),
    seqNum: $('pdSeqNum'),
    status: $('pdStatus'),
    window: $('pdWindow'),
    attempts: $('pdAttempts'),
    ack: $('pdAck')
  },

  baseVal: $('baseVal'),
  nextSeqVal: $('nextSeqVal'),
  windowValLabel: $('windowValLabel'),
  windowFrame: $('windowFrame'),
  senderTrack: $('senderTrack'),
  receiverTrack: $('receiverTrack'),
  expectedVal: $('expectedVal'),
  channel: $('channel'),
  timerBar: $('timerBar'),
  timerBaseSeq: $('timerBaseSeq'),
  timerPolicyTag: $('timerPolicyTag'),
  timerFill: $('timerFill'),

  stats: {
    sent: $('statSent'),
    received: $('statReceived'),
    lost: $('statLost'),
    retransmitted: $('statRetransmitted'),
    acksSent: $('statAcksSent'),
    acksReceived: $('statAcksReceived'),
    timeouts: $('statTimeouts'),
    efficiency: $('statEfficiency')
  },

  timelineList: $('timelineList'),
  clockDisplay: $('clockDisplay'),
  evaluationPanel: $('evaluationPanel'),
evaluationStart: $('evaluationStart'),
startEvaluationBtn: $('startEvaluationBtn')
};

// ---- app state ------------------------------------------------------------

let selectedSeq = null;

const evaluation = new Evaluation({
  onQuestion: (question) => {
    sim.pause();

    renderEvaluationQuestion(
      els.evaluationPanel,
      question,
      evaluation.getState()
    );
  },

  onResult: (result) => {
    if (result.correct !== undefined) {
      renderEvaluationResult(
        els.evaluationPanel,
        result
      );
    }
  },

  onFinish: (result) => {
    renderEvaluationFinal(
      els.evaluationPanel,
      result
    );
  }
});


const sim = new Simulation(
  {
    totalPackets: 8,
    windowSize: 4,
    timeoutMs: 7500,
    mode: 'full',
    speedMultiplier: 0.75
  },

  
  {
    onTick: (state) => render(state),

    onTimelineEvent: (event) => {
      renderTimeline(
        els.timelineList,
        sim.timeline.events
      );

      // La evaluación analiza cada evento de la simulación.
      if (evaluation.isActive() && event) {
        evaluation.processEvent(
          event,
          sim.getState()
        );
      }
    },

    onStatsChange: (stats) =>
      renderStats(els.stats, stats)
    
  }
);

// ---- render ----------------------------------------------------------------

function render(state) {
  els.clockDisplay.textContent = formatClock(state.clockMs);

  els.baseVal.textContent = state.window.base;
  els.nextSeqVal.textContent = state.window.nextSeqNum;
  els.windowValLabel.textContent = state.window.size;
  els.expectedVal.textContent = `Packet ${state.expectedSeqNum}`;

  renderPacketTrack(els.senderTrack, state.packets, {
    selectedSeq,
    onSelect: selectPacket
  });
  renderPacketTrack(els.receiverTrack, state.packets, {
    selectedSeq,
    onSelect: selectPacket
  });

  renderWindowFrame(
    els.windowFrame,
    els.senderTrack,
    state.window.base,
    state.window.nextSeqNum,
    state.window.size,
    state.config.totalPackets
  );

  renderChannelItems(els.channel, state.channelItems, { onLose: loseChannelItem });

  if (state.window.timerActive) {
    els.timerBar.hidden = false;
    els.timerBaseSeq.textContent = state.window.timerSeq;
    els.timerPolicyTag.textContent =
      state.config.policy === 'sr' ? ` (Selective Repeat · ${state.activeTimerCount} timers activos)` : '';
    els.timerFill.style.width = `${Math.round(state.window.timerProgress * 100)}%`;
  } else {
    els.timerBar.hidden = true;
  }

  els.policyGbnBtn.classList.toggle('is-active', state.config.policy === 'gbn');
  els.policySrBtn.classList.toggle('is-active', state.config.policy === 'sr');

  els.windowSizeInput.max = state.maxWindowSize;
  if (Number(els.windowSizeInput.value) !== state.window.size) {
    els.windowSizeInput.value = state.window.size;
  }
  els.windowSizeVal.textContent = state.window.size;

  const range = 2 ** state.config.sequenceBits;
  const policyLabel = state.config.policy === 'sr' ? 'Selective Repeat' : 'Go-Back-N';
  els.windowLimitHint.textContent = `Rango 0..${range - 1} · ventana máxima con ${policyLabel}: ${state.maxWindowSize}`;
  els.windowLimitHint.classList.toggle('hint--warn', state.window.size >= state.maxWindowSize);

  const rttMs = state.config.propagationDelayMs * 2;
  els.rttHint.textContent = `RTT estimado (ida + vuelta): ${(rttMs / 1000).toFixed(1)}s`;
  els.rttHint.classList.toggle('hint--warn', rttMs > state.config.timeoutMs);

  const packet = selectedSeq !== null ? state.packets.find((p) => p.seq === selectedSeq) : null;
  const inWindow = packet ? selectedSeq >= state.window.base && selectedSeq < state.window.base + state.window.size : false;
  renderPacketDetail(els.packetDetail, els.pd, packet, { inWindow });

  updateLoseButton(packet);

  els.autoSendBtn.classList.toggle('is-on', state.autoSendEnabled);
  els.startBtn.disabled = state.running;
  els.pauseBtn.disabled = !state.running;
  renderGBNDiagram(els.gbnSvg, state.channelItems);
}

function updateLoseButton(packet) {
  if (!packet) {
    els.loseSelectedBtn.disabled = true;
    return;
  }

  const state = sim.getState();

  // ¿Hay un paquete de datos seleccionado que todavía está viajando?
  const dataInTransit = state.channelItems.some(
    (item) =>
      item.kind === 'data' &&
      item.seq === packet.seq
  );

  // ¿Hay un ACK de este paquete viajando hacia el emisor?
  const ackInTransit = state.channelItems.some(
    (item) =>
      item.kind === 'ack' &&
      item.ack === packet.seq
  );

  const canLosePacket =
    packet.status === 'waiting' ||
    packet.status === 'in_transit' ||
    packet.status === 'sent';

  els.loseSelectedBtn.disabled =
    !(canLosePacket || dataInTransit || ackInTransit);
}

function selectPacket(seq) {
  selectedSeq = selectedSeq === seq ? null : seq;
  render(sim.getState());
}



function loseChannelItem(itemId) {
  sim.loseInFlightItem(itemId);
}

// ---- control wiring ---------------------------------------------------------

els.startBtn.addEventListener('click', () => sim.start());
els.pauseBtn.addEventListener('click', () => sim.pause());
els.resetBtn.addEventListener('click', () => {
  selectedSeq = null;

  evaluation.reset();

  els.evaluationPanel.hidden = true;
  els.evaluationPanel.innerHTML = '';
  els.evaluationStart.hidden = false;

   resetGBNDiagram(els.gbnSvg);

  sim.reset();

  render(sim.getState());

  renderTimeline(
    els.timelineList,
    sim.timeline.events
  );
});

els.modeFullBtn.addEventListener('click', () => setMode('full'));
els.modeHalfBtn.addEventListener('click', () => setMode('half'));
function setMode(mode) {
  sim.setMode(mode);
  els.modeFullBtn.classList.toggle('is-active', mode === 'full');
  els.modeHalfBtn.classList.toggle('is-active', mode === 'half');
}

els.windowSizeInput.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  const applied = sim.setWindowSize(val); // puede venir recortado por la política/bits
  els.windowSizeVal.textContent = applied;
  if (applied !== val) e.target.value = applied;
});

els.policyGbnBtn.addEventListener('click', () => setPolicy('gbn'));
els.policySrBtn.addEventListener('click', () => setPolicy('sr'));
function setPolicy(policy) {
  selectedSeq = null;
  sim.setPolicy(policy);
  render(sim.getState());
  renderTimeline(els.timelineList, sim.timeline.events);
}

els.sequenceBitsInput.addEventListener('change', (e) => {
  const bits = Number(e.target.value);
  els.sequenceBitsVal.textContent = bits;
  sim.setSequenceBits(bits);
  els.windowSizeInput.value = sim.config.windowSize;
  els.windowSizeVal.textContent = sim.config.windowSize;
});

els.packetCountInput.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  els.packetCountVal.textContent = val;
});
els.packetCountInput.addEventListener('change', (e) => {
  const val = Number(e.target.value);
  selectedSeq = null;
  sim.setPacketCount(val);
});

els.timeoutInput.addEventListener('input', (e) => {
  const ms = Number(e.target.value);
  els.timeoutVal.textContent = `${(ms / 1000).toFixed(1)}s`;
  sim.setTimeout(ms);
});

els.propDelayInput.addEventListener('input', (e) => {
  const ms = Number(e.target.value);
  els.propDelayVal.textContent = `${(ms / 1000).toFixed(1)}s`;
  sim.setPropagationDelay(ms);
});

els.speedInput.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  els.speedVal.textContent = `${val.toFixed(2)}×`;
  sim.setSpeed(val);
});

els.randomLossInput.addEventListener('change', (e) => {
  sim.toggleRandomLoss(e.target.checked);
  els.randomLossRateField.hidden = !e.target.checked;
});

els.randomLossRateInput.addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  els.randomLossRateVal.textContent = `${pct}%`;
  sim.setRandomLossRate(pct / 100);
});

els.sendNextBtn.addEventListener('click', () => sim.sendNext());
els.sendWindowBtn.addEventListener('click', () => sim.sendWindow());

els.autoSendBtn.addEventListener('click', () => {
  sim.toggleAutoSend(!sim.autoSendEnabled);
  render(sim.getState());
});

els.forceTimeoutBtn.addEventListener('click', () => sim.forceTimeout());

els.loseSelectedBtn.addEventListener('click', () => {
  if (selectedSeq === null) return;
  const state = sim.getState();
  const packet = state.packets.find((p) => p.seq === selectedSeq);
  if (!packet) return;

  if (packet.status === 'waiting') {
    sim.queueManualLoss(selectedSeq);
  } else if (packet.status === 'in_transit' || packet.status === 'sent') {
    const item = state.channelItems.find((i) => i.kind === 'data' && i.seq === selectedSeq);
    if (item) sim.loseInFlightItem(item.id);
  }
  render(sim.getState());
});

// ============================================================
// EVALUACIÓN
// ============================================================

els.startEvaluationBtn.addEventListener('click', () => {
  els.evaluationPanel.innerHTML = '';  
  evaluation.start();

  els.evaluationStart.hidden = true;
  els.evaluationPanel.hidden = false;

  // Iniciar la simulación.
  sim.start();
});


els.evaluationPanel.addEventListener(
  'evaluation-answer',
  (event) => {
    evaluation.answer(event.detail.answer);
  }
);


els.evaluationPanel.addEventListener(
  'evaluation-continue',
  (event) => {
    if (event.detail.finished) {
      return;
    }

    els.evaluationPanel.hidden = true;

    sim.start();
  }
);


els.evaluationPanel.addEventListener(
  'evaluation-restart',
  () => {
    evaluation.reset();

    els.evaluationPanel.hidden = true;
    els.evaluationPanel.innerHTML = '';
    els.evaluationStart.hidden = false;

    sim.reset();

    render(sim.getState());

    renderTimeline(
      els.timelineList,
      sim.timeline.events
    );
  }
);

// ---- initial paint ------------------------------------------------------------

render(sim.getState());
