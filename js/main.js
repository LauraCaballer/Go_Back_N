import { Simulation } from './Simulation.js';
import {
  renderPacketTrack,
  renderWindowFrame,
  renderChannelItems,
  renderTimeline,
  renderStats,
  renderPacketDetail,
  formatClock
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

  windowSizeInput: $('windowSizeInput'),
  windowSizeVal: $('windowSizeVal'),
  packetCountInput: $('packetCountInput'),
  packetCountVal: $('packetCountVal'),
  timeoutInput: $('timeoutInput'),
  timeoutVal: $('timeoutVal'),
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
    els.timerBaseSeq.textContent = state.window.base;
    els.timerFill.style.width = `${Math.round(state.window.timerProgress * 100)}%`;
  } else {
    els.timerBar.hidden = true;
  }

  const packet = selectedSeq !== null ? state.packets.find((p) => p.seq === selectedSeq) : null;
  const inWindow = packet ? selectedSeq >= state.window.base && selectedSeq < state.window.base + state.window.size : false;
  renderPacketDetail(els.packetDetail, els.pd, packet, { inWindow });

  updateLoseButton(packet);

  els.autoSendBtn.classList.toggle('is-on', state.autoSendEnabled);
  els.startBtn.disabled = state.running;
  els.pauseBtn.disabled = !state.running;
}

function updateLoseButton(packet) {
  if (!packet) {
    els.loseSelectedBtn.disabled = true;
    return;
  }
  els.loseSelectedBtn.disabled = !(packet.status === 'waiting' || packet.status === 'in_transit' || packet.status === 'sent');
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
  els.evaluationStart.hidden = false;

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
  els.windowSizeVal.textContent = val;
  sim.setWindowSize(val);
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
