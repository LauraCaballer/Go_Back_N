import { PiggybackSimulation } from './PiggybackSimulation.js';
import { renderPacketTrack, renderWindowFrame, renderTimeline, formatClock } from './ui/Renderer.js';
import {
  renderDuplexChannelItems,
  renderStationHeader,
  renderStationTimer,
  renderPiggybackStats,
  renderPiggybackDiagram,
  resetPiggybackDiagram
} from './ui/PiggybackRenderer.js';

const $ = (id) => document.getElementById(id);

const els = {
  startBtn: $('startBtn'),
  pauseBtn: $('pauseBtn'),
  resetBtn: $('resetBtn'),
  modeFullBtn: $('modeFullBtn'),
  modeHalfBtn: $('modeHalfBtn'),

  policyGbnBtn: $('policyGbnBtn'),
  policySrBtn: $('policySrBtn'),
  sequenceBitsInput: $('sequenceBitsInput'),
  sequenceBitsVal: $('sequenceBitsVal'),
  windowLimitHint: $('windowLimitHint'),
  windowSizeInput: $('windowSizeInput'),
  windowSizeVal: $('windowSizeVal'),
  packetCountInput: $('packetCountInput'),
  packetCountVal: $('packetCountVal'),
  timeoutInput: $('timeoutInput'),
  timeoutVal: $('timeoutVal'),
  propDelayInput: $('propDelayInput'),
  propDelayVal: $('propDelayVal'),
  rttHint: $('rttHint'),
  ackHoldInput: $('ackHoldInput'),
  ackHoldVal: $('ackHoldVal'),
  speedInput: $('speedInput'),
  speedVal: $('speedVal'),
  randomLossInput: $('randomLossInput'),
  randomLossRateField: $('randomLossRateField'),
  randomLossRateInput: $('randomLossRateInput'),
  randomLossRateVal: $('randomLossRateVal'),

  channel: $('channel'),
  pbSvg: $('pbSvg'),
  timelineList: $('timelineList'),
  clockDisplay: $('clockDisplay'),

  stats: {
    sentA: $('statSentA'),
    sentB: $('statSentB'),
    received: $('statReceived'),
    lost: $('statLost'),
    timeouts: $('statTimeouts'),
    acksPiggybacked: $('statAcksPiggybacked'),
    acksNaked: $('statAcksNaked'),
    piggybackRate: $('statPiggybackRate')
  },

  A: {
    baseVal: $('baseValA'),
    nextSeqVal: $('nextSeqValA'),
    windowVal: $('windowValA'),
    expectedVal: $('expectedValA'),
    windowFrame: $('windowFrameA'),
    track: $('trackA'),
    timerBar: $('timerBarA'),
    timerSeq: $('timerSeqA'),
    timerFill: $('timerFillA'),
    sendNextBtn: $('sendNextABtn'),
    autoSendBtn: $('autoSendABtn'),
    loseNextBtn: $('loseNextABtn'),
    forceTimeoutBtn: $('forceTimeoutABtn'),
    ackBadge: $('ackBadgeA')
  },
  B: {
    baseVal: $('baseValB'),
    nextSeqVal: $('nextSeqValB'),
    windowVal: $('windowValB'),
    expectedVal: $('expectedValB'),
    windowFrame: $('windowFrameB'),
    track: $('trackB'),
    timerBar: $('timerBarB'),
    timerSeq: $('timerSeqB'),
    timerFill: $('timerFillB'),
    sendNextBtn: $('sendNextBBtn'),
    autoSendBtn: $('autoSendBBtn'),
    loseNextBtn: $('loseNextBBtn'),
    forceTimeoutBtn: $('forceTimeoutBBtn'),
    ackBadge: $('ackBadgeB')
  }
};

const sim = new PiggybackSimulation(
  {
    totalPackets: 6,
    windowSize: 4,
    timeoutMs: 7500,
    propagationDelayMs: 2000,
    ackHoldMs: 900,
    mode: 'full',
    speedMultiplier: 0.75
  },
  {
    onTick: (state) => render(state),
    onTimelineEvent: () => renderTimeline(els.timelineList, sim.timeline.events)
  }
);

function render(state) {
  els.clockDisplay.textContent = formatClock(state.clockMs);

  ['A', 'B'].forEach((id) => {
    const station = state[`station${id}`];
    const ui = els[id];

    renderStationHeader(ui, station, id);
    renderPacketTrack(ui.track, station.packets, { selectedSeq: null, onSelect: () => {} });
    renderWindowFrame(ui.windowFrame, ui.track, station.window.base, station.window.nextSeqNum, station.window.size, state.config.totalPackets);
    renderStationTimer(ui, station);

    ui.sendNextBtn.disabled = station.finished;
    ui.forceTimeoutBtn.disabled = station.finished;
  });

  renderDuplexChannelItems(els.channel, state.channelItems, { onLose: loseChannelItem });
  renderPiggybackStats(els.stats, state.stats);
  renderPiggybackDiagram(els.pbSvg, state.channelItems, state.clockMs);

  els.startBtn.disabled = state.running;
  els.pauseBtn.disabled = !state.running;

  els.policyGbnBtn.classList.toggle('is-active', state.config.policy === 'gbn');
  els.policySrBtn.classList.toggle('is-active', state.config.policy === 'sr');

  els.windowSizeInput.max = state.maxWindowSize;
  if (Number(els.windowSizeInput.value) !== state.config.windowSize) {
    els.windowSizeInput.value = state.config.windowSize;
  }
  els.windowSizeVal.textContent = state.config.windowSize;

  const range = 2 ** state.config.sequenceBits;
  const policyLabel = state.config.policy === 'sr' ? 'Selective Repeat' : 'Go-Back-N';
  els.windowLimitHint.textContent = `Rango 0..${range - 1} · ventana máxima con ${policyLabel}: ${state.maxWindowSize}`;
  els.windowLimitHint.classList.toggle('hint--warn', state.config.windowSize >= state.maxWindowSize);

  const rttMs = state.config.propagationDelayMs * 2;
  els.rttHint.textContent = `RTT estimado (ida + vuelta): ${(rttMs / 1000).toFixed(1)}s`;
  els.rttHint.classList.toggle('hint--warn', rttMs > state.config.timeoutMs);
}

function loseChannelItem(itemId) {
  sim.loseInFlightItem(itemId);
}

// ---- control wiring ---------------------------------------------------

els.startBtn.addEventListener('click', () => sim.start());
els.pauseBtn.addEventListener('click', () => sim.pause());
els.resetBtn.addEventListener('click', () => {
  sim.reset();
  resetPiggybackDiagram(els.pbSvg);
  render(sim.getState());
  renderTimeline(els.timelineList, sim.timeline.events);
});

els.modeFullBtn.addEventListener('click', () => setMode('full'));
els.modeHalfBtn.addEventListener('click', () => setMode('half'));
function setMode(mode) {
  sim.setMode(mode);
  els.modeFullBtn.classList.toggle('is-active', mode === 'full');
  els.modeHalfBtn.classList.toggle('is-active', mode === 'half');
}

els.policyGbnBtn.addEventListener('click', () => setPolicy('gbn'));
els.policySrBtn.addEventListener('click', () => setPolicy('sr'));
function setPolicy(policy) {
  sim.setPolicy(policy);
  resetPiggybackDiagram(els.pbSvg);
  render(sim.getState());
  renderTimeline(els.timelineList, sim.timeline.events);
}

els.sequenceBitsInput.addEventListener('change', (e) => {
  const bits = Number(e.target.value);
  els.sequenceBitsVal.textContent = bits;
  sim.setSequenceBits(bits);
});

els.windowSizeInput.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  const applied = sim.setWindowSize(val);
  els.windowSizeVal.textContent = applied;
  if (applied !== val) e.target.value = applied;
});

els.packetCountInput.addEventListener('input', (e) => {
  els.packetCountVal.textContent = e.target.value;
});
els.packetCountInput.addEventListener('change', (e) => {
  sim.setPacketCount(Number(e.target.value));
  resetPiggybackDiagram(els.pbSvg);
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

els.ackHoldInput.addEventListener('input', (e) => {
  const ms = Number(e.target.value);
  els.ackHoldVal.textContent = `${(ms / 1000).toFixed(1)}s`;
  sim.setAckHold(ms);
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

['A', 'B'].forEach((id) => {
  const ui = els[id];

  ui.sendNextBtn.addEventListener('click', () => sim.sendNext(id));

  ui.autoSendBtn.addEventListener('click', () => {
    const currentlyOn = ui.autoSendBtn.classList.contains('is-on');
    sim.toggleAutoSend(id, !currentlyOn);
  });

  ui.loseNextBtn.addEventListener('click', () => {
    const station = id === 'A' ? sim.stationA : sim.stationB;
    const seq = station.sender.nextSeqToSend();
    if (seq !== null) sim.queueManualLoss(id, seq);
  });

  ui.forceTimeoutBtn.addEventListener('click', () => sim.forceTimeout(id));
});

// ---- initial paint ------------------------------------------------------

render(sim.getState());
