// Renderer.js — turns a Simulation state snapshot into DOM updates.
// Kept free of simulation logic on purpose: it only reads state and
// reports user gestures back via callbacks.

const STATUS_LABEL = {
  waiting: 'Esperando',
  sent: 'Enviado',
  in_transit: 'En tránsito',
  received: 'Recibido',
  acked: 'ACK recibido',
  lost: 'Perdido',
  out_of_order: 'Fuera de orden',
  retransmitted: 'Retransmitido'
};

export function renderPacketTrack(trackEl, packets, { selectedSeq, onSelect }) {
  // Guardamos los botones que ya existen para NO recrearlos en cada tick.
  const existingPackets = new Map();

  trackEl.querySelectorAll('.packet').forEach((el) => {
    const seq = Number(el.dataset.seq);
    existingPackets.set(seq, el);
  });

  const activeSeqs = new Set();

  packets.forEach((p) => {
    activeSeqs.add(p.seq);

    let el = existingPackets.get(p.seq);

    // Solo creamos el botón la primera vez.
    if (!el) {
      el = document.createElement('button');

      el.type = 'button';
      el.dataset.seq = p.seq;

      el.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const seq = Number(event.currentTarget.dataset.seq);

        if (Number.isNaN(seq)) return;

        onSelect?.(seq);
      });

      trackEl.appendChild(el);
    }

    // Actualizamos únicamente la información visual.
    el.className =
      `packet packet--${p.status}` +
      (p.seq === selectedSeq ? ' is-selected' : '');

    el.title =
      `Packet ${p.seq} — ${STATUS_LABEL[p.status] || p.status}`;

    // Actualizamos el contenido sin destruir el botón.
    el.textContent = p.seq;

    if (p.attempts > 1) {
      const badge = document.createElement('span');

      badge.className = 'packet__badge';
      badge.textContent = `×${p.attempts}`;

      el.appendChild(badge);
    }
  });

  // Eliminamos únicamente paquetes que ya no existen.
  existingPackets.forEach((el, seq) => {
    if (!activeSeqs.has(seq)) {
      el.remove();
    }
  });
}

export function renderWindowFrame(frameEl, trackEl, base, nextSeqNum, size, totalPackets) {
  frameEl.innerHTML = '';
  const children = trackEl.children;
  if (!children.length) return;

  const windowEnd = Math.min(base + size, totalPackets) - 1;
  if (windowEnd < base) return;

  const startChild = children[base];
  const endChild = children[Math.min(windowEnd, children.length - 1)];
  if (!startChild || !endChild) return;

  const left = startChild.offsetLeft;
  const width = endChild.offsetLeft + endChild.offsetWidth - left;

  const bracket = document.createElement('div');
  bracket.className = 'window-frame__bracket';
  bracket.style.left = `${left}px`;
  bracket.style.width = `${width}px`;
  frameEl.appendChild(bracket);
}

export function renderChannelItems(channelEl, items, { onLose }) {
  // Remove DOM nodes for items no longer present.
  const currentIds = new Set(items.map((i) => i.id));
  channelEl.querySelectorAll('.channel-item').forEach((node) => {
    if (!currentIds.has(node.dataset.id)) node.remove();
  });

  const railDown = channelEl.querySelector('.channel__rail--down');
  const railUp = channelEl.querySelector('.channel__rail--up');
  const width = channelEl.clientWidth;

  items.forEach((item) => {
    let node = channelEl.querySelector(`.channel-item[data-id="${item.id}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = `channel-item channel-item--${item.kind}`;
      node.dataset.id = item.id;
      node.addEventListener('click', () => onLose(item.id));
      channelEl.appendChild(node);
    }

    const isDown = item.direction === 'down';
    const progress = isDown ? item.progress : 1 - item.progress; // ack travels right->left
    const x = 24 + progress * (width - 48);
    const yPercent = isDown ? 34 : 68;

    node.style.left = `${x}px`;
    node.style.top = `${yPercent}%`;
    node.classList.toggle('channel-item--doomed', !!item.willBeLost);
    node.classList.toggle('channel-item--vanishing', !!item.lost);
    node.textContent = item.kind === 'data' ? `Packet ${item.seq}` : `ACK ${item.seq}`;
  });
}

export function renderTimeline(listEl, events) {
  listEl.innerHTML = '';

  [...events].reverse().forEach((ev) => {
    const li = document.createElement('li');

    li.innerHTML = `
      <span class="timeline__time">[${ev.time}]</span>
      <span class="timeline__type timeline__type--${ev.type}">${ev.type}</span>
      <span class="timeline__desc">${ev.description}</span>
    `;

    listEl.appendChild(li);
  });

  // Mantener visible siempre el evento más reciente.
  listEl.scrollTop = 0;
}
export function renderStats(els, stats) {
  els.sent.textContent = stats.sent;
  els.received.textContent = stats.received;
  els.lost.textContent = stats.lost;
  els.retransmitted.textContent = stats.retransmitted;
  els.acksSent.textContent = stats.acksSent;
  els.acksReceived.textContent = stats.acksReceived;
  els.timeouts.textContent = stats.timeouts;
  els.efficiency.textContent = `${stats.efficiency}%`;
}

export function renderPacketDetail(panelEl, fields, packet, { inWindow }) {
  if (!packet) {
    panelEl.hidden = true;
    return;
  }
  panelEl.hidden = false;
  fields.seq.textContent = packet.seq;
  fields.seqNum.textContent = packet.seq;
  fields.status.textContent = STATUS_LABEL[packet.status] || packet.status;
  fields.window.textContent = inWindow ? 'Sí' : 'No';
  fields.attempts.textContent = packet.attempts;
  fields.ack.textContent = packet.status === 'acked' ? 'Confirmado' : 'Pendiente';
}

export function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
