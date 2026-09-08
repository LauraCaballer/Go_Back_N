// PiggybackRenderer.js — funciones de pintado específicas de la pestaña
// "Conversación (Piggybacking)". Reutiliza a propósito renderPacketTrack,
// renderWindowFrame y renderTimeline de Renderer.js (son genéricas, no
// dependen de haber solo un emisor fijo), y solo agrega lo que SÍ es
// distinto aquí: el canal bidireccional con items combinados, y las
// estadísticas de piggyback.

export function renderDuplexChannelItems(channelEl, items, { onLose }) {
  const currentIds = new Set(items.map((i) => i.id));
  channelEl.querySelectorAll('.channel-item').forEach((node) => {
    if (!currentIds.has(node.dataset.id)) node.remove();
  });

  const width = channelEl.clientWidth;

  items.forEach((item) => {
    let node = channelEl.querySelector(`.channel-item[data-id="${item.id}"]`);
    const isCombined = item.dataSeq !== null && item.ackNum !== null;
    const isNakedAck = item.dataSeq === null && item.ackNum !== null;
    const kindClass = isCombined ? 'combined' : isNakedAck ? 'naked-ack' : 'data';

    if (!node) {
      node = document.createElement('div');
      node.className = `channel-item channel-item--${kindClass}`;
      node.dataset.id = item.id;
      node.addEventListener('click', () => onLose(item.id));
      channelEl.appendChild(node);
    } else {
      node.className = `channel-item channel-item--${kindClass}`;
    }

    const isAtoB = item.direction === 'aToB';
    const progress = isAtoB ? item.progress : 1 - item.progress;
    const x = 24 + progress * (width - 48);
    const yPercent = isAtoB ? 34 : 68;

    node.style.left = `${x}px`;
    node.style.top = `${yPercent}%`;
    node.classList.toggle('channel-item--doomed', !!item.willBeLost);
    node.classList.toggle('channel-item--vanishing', !!item.lost);

    if (isCombined) {
      node.textContent = `Pkt ${item.dataSeq} + ACK ${item.ackNum}`;
    } else if (isNakedAck) {
      node.textContent = `ACK ${item.ackNum}`;
    } else {
      node.textContent = `Pkt ${item.dataSeq}`;
    }
  });
}

export function renderStationHeader(els, station, id) {
  els.baseVal.textContent = station.window.base;
  els.nextSeqVal.textContent = station.window.nextSeqNum;
  els.windowVal.textContent = station.window.size;
  els.expectedVal.textContent = `Packet ${station.expectedSeqNum}`;

  if (station.pendingAckCount > 0) {
    els.ackBadge.hidden = false;
    els.ackBadge.textContent = `${station.pendingAckCount} ACK en espera de piggyback`;
    els.ackBadge.classList.add('ack-badge--waiting');
  } else {
    els.ackBadge.hidden = true;
  }

  els.autoSendBtn.classList.toggle('is-on', station.autoSendEnabled);
}

export function renderStationTimer(els, station) {
  if (station.window.timerActive) {
    els.timerBar.hidden = false;
    els.timerSeq.textContent = station.window.timerSeq;
    els.timerFill.style.width = `${Math.round(station.window.timerProgress * 100)}%`;
  } else {
    els.timerBar.hidden = true;
  }
}

export function renderPiggybackStats(els, stats) {
  els.sentA.textContent = stats.sentA;
  els.sentB.textContent = stats.sentB;
  els.received.textContent = stats.received;
  els.lost.textContent = stats.lost;
  els.timeouts.textContent = stats.timeouts;
  els.acksPiggybacked.textContent = stats.acksPiggybacked;
  els.acksNaked.textContent = stats.acksNaked;
  els.piggybackRate.textContent = `${stats.piggybackRate}%`;
}

// ---- diagrama en tiempo real (línea de vida A/B) ---------------------
//
// Se lee de arriba hacia abajo, igual que el diagrama Go-Back-N de la
// otra pestaña: una fila nueva por cada frame que aparece en el canal.
//   · Solo dato de A  -> una línea gris.
//   · Solo dato de B  -> una línea rosada.
//   · Dato + ACK montado (piggyback) -> DOS líneas paralelas, versión
//     clara del gris y del rosado (según quién lo mandó).
//   · ACK puro (naked, viajó solo) -> una sola línea oscura.
//   · Si el frame está marcado para perderse -> la línea sale
//     entrecortada desde el principio, no solo al llegar a la mitad.
// El margen izquierdo funciona como regla de tiempo: cada fila queda
// etiquetada con el reloj virtual (mm:ss) en el momento en que ese
// frame salió al canal.

const pbDrawn = new Map(); // item.id -> { lines: [line,...], row }
let pbRowCounter = 0;

const ROW_HEIGHT = 46;
const ROW_DIAGONAL = 18; // cuánto "cae" la línea de izquierda a derecha
const TOP_MARGIN = 34;
const TIME_COL = 46; // ancho reservado para la etiqueta de tiempo
const OFFSET = 3; // separación entre las dos líneas de un frame combinado

function pbColors(item) {
  const isCombined = item.dataSeq !== null && item.ackNum !== null;
  const isNakedAck = item.dataSeq === null && item.ackNum !== null;
  const isFromA = item.from === 'A';

  if (isNakedAck) return [{ color: 'var(--diagram-dark)', dashed: true }];
  if (isCombined) {
    return [
      { color: isFromA ? 'var(--diagram-gray-light)' : 'var(--diagram-pink-light)', dashed: false, offset: -OFFSET },
      { color: isFromA ? 'var(--diagram-pink-light)' : 'var(--diagram-gray-light)', dashed: false, offset: OFFSET }
    ];
  }
  // Dato solo.
  return [{ color: isFromA ? 'var(--diagram-gray)' : 'var(--accent-teal)', dashed: false }];
}

export function renderPiggybackDiagram(svgEl, channelItems, clockMs) {
  if (!svgEl) return;

  const width = svgEl.clientWidth || 340;
  const leftX = TIME_COL + 26;
  const rightX = width - 26;

  channelItems.forEach((item) => {
    let entry = pbDrawn.get(item.id);
    const colors = pbColors(item);

    if (!entry) {
      const row = pbRowCounter++;
      const baseY = TOP_MARGIN + row * ROW_HEIGHT;

      const timeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      timeLabel.setAttribute('class', 'gbn-diagram__time-label');
      timeLabel.setAttribute('x', 4);
      timeLabel.setAttribute('y', baseY - 6);
      timeLabel.textContent = formatClockShort(clockMs);
      svgEl.appendChild(timeLabel);

      const axisTick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      axisTick.setAttribute('class', 'gbn-diagram__time-axis');
      axisTick.setAttribute('x1', TIME_COL);
      axisTick.setAttribute('y1', baseY);
      axisTick.setAttribute('x2', width - 6);
      axisTick.setAttribute('y2', baseY);
      svgEl.appendChild(axisTick);

      const lines = colors.map((c) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'gbn-line');
        // OJO: se fija por `style` (no por setAttribute) a propósito.
        // La clase .gbn-line ya trae `stroke: var(--accent-teal)` definido
        // en la hoja de estilos, y una regla de CSS SIEMPRE le gana a un
        // atributo de presentación (setAttribute), sin importar el orden
        // en que se apliquen. `style` inline sí tiene prioridad sobre la
        // hoja de estilos — por eso antes todo salía rosado.
        line.style.stroke = c.color;
        svgEl.appendChild(line);
        return line;
      });

      entry = { lines, row, baseY };
      pbDrawn.set(item.id, entry);
    }

    const isAtoB = item.direction === 'aToB';
    const x1 = isAtoB ? leftX : rightX;
    const x2raw = isAtoB ? rightX : leftX;
    const p = item.progress;
    const x2 = x1 + (x2raw - x1) * p;
    const y = entry.baseY;
    // Leve inclinación hacia abajo a medida que avanza, igual que en el
    // diagrama Go-Back-N original — una línea perfectamente horizontal
    // se ve "plana" y cuesta más leer el sentido del tiempo.
    const yDrift = ROW_DIAGONAL * p;

    entry.lines.forEach((line, idx) => {
      const c = colors[idx];
      const perpOffset = c.offset || 0;
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y + perpOffset);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y + perpOffset + yDrift);
      line.classList.toggle('gbn-line--lost', !!item.willBeLost || c.dashed);
      if (p >= 1) line.style.opacity = '0.75';
    });
  });

  const totalRows = pbRowCounter;
  svgEl.setAttribute('height', TOP_MARGIN + totalRows * ROW_HEIGHT + 20);
}

export function resetPiggybackDiagram(svgEl) {
  pbDrawn.clear();
  pbRowCounter = 0;
  if (svgEl) svgEl.innerHTML = '';
}

function formatClockShort(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
