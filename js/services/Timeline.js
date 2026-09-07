// Timeline.js — chronological log of everything that happens in the
// simulation, driven by the simulation's own virtual clock (not wall time).

export const EventType = Object.freeze({
  INFO: 'info',
  SEND: 'send',
  RECEIVE: 'receive',
  ACK_SENT: 'ack-sent',
  ACK_RECEIVED: 'ack-received',
  LOSS: 'loss',
  DISCARD: 'discard',
  TIMEOUT: 'timeout',
  RETRANSMIT: 'retransmit'
});

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export class Timeline {
  constructor({ onChange } = {}) {
    this.events = [];
    this.onChange = onChange || (() => {});
  }

  add(clockMs, type, ref, description) {
    const event = {
      id: this.events.length,
      time: formatTime(clockMs),
      rawMs: clockMs,
      type,
      ref,
      description
    };
    this.events.push(event);
    this.onChange(event, this.events);
    return event;
  }

  reset() {
    this.events = [];
    this.onChange(null, this.events);
  }
}
