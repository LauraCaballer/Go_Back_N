# Simulador Go-Back-N (Sliding Window ARQ)

Simulación web interactiva y educativa del protocolo **Go-Back-N**. Implementa
la lógica real del protocolo (no solo una animación): ventana deslizante con
`base` / `nextSeqNum`, ACKs acumulativos, temporizador de retransmisión,
descarte de paquetes fuera de orden y pérdida de paquetes manual o aleatoria.

## Cómo ejecutarla

Los módulos JavaScript usan `import`/`export` de ES Modules, así que el
navegador necesita servirlos por HTTP (no funciona con doble clic sobre
`index.html`, es decir con `file://`). Desde esta carpeta, levanta cualquier
servidor estático:

```bash
# Opción 1: Python (ya viene instalado en la mayoría de sistemas)
python3 -m http.server 8000

# Opción 2: Node
npx serve .
```

Luego abre `http://localhost:8000` en el navegador.

## Cómo usarlo

- **Panel de configuración** (izquierda): tamaño de ventana, número de
  paquetes, timeout, velocidad de animación y pérdida aleatoria.
- **▶ Iniciar / ⏸ Pausar / ↻ Reiniciar**: controlan el reloj de la simulación.
- **Enviar siguiente / Enviar ventana / Enviar automático**: formas de
  transmitir paquetes desde el emisor.
- **Clic sobre un paquete** (emisor o receptor) para ver su detalle e
  información de secuencia.
- **Simular pérdida**: con un paquete seleccionado, lo marca para que se
  pierda (si aún no fue enviado) o lo elimina inmediatamente (si ya está en
  tránsito).
- **Clic sobre un paquete o ACK dentro del canal** también lo elimina al
  instante — así puedes provocar la pérdida exactamente cuando quieras.
- **Forzar timeout**: dispara de inmediato el timeout del paquete `base`
  para ver la retransmisión Go-Back-N sin esperar.
- **Half Duplex / Full Duplex**: alterna si el canal permite tráfico
  simultáneo en ambos sentidos o solo uno a la vez.

## Arquitectura del código

```
index.html
css/
  styles.css              Identidad visual (consola de diagnóstico de red)
js/
  models/
    Packet.js              Modelo de paquete y sus estados
    Ack.js                 Modelo de ACK (acumulativo)
    SlidingWindow.js        base / nextSeqNum / tamaño de ventana
    Channel.js              Medio de transmisión: anima ítems en vuelo,
                             arbitra half/full duplex, resuelve pérdidas
    Sender.js               Lado emisor: qué se puede enviar, temporizador
                             de retransmisión, aplica ACKs acumulativos
    Receiver.js              Lado receptor: acepta en orden, descarta fuera
                             de orden, decide qué ACK responder
  services/
    Timeline.js             Registro cronológico de eventos
    Statistics.js           Contadores para el panel de estadísticas
  ui/
    Renderer.js              Funciones puras que pintan el estado en el DOM
  Simulation.js              Orquestador: reloj virtual, conecta modelos y
                             servicios, expone la API de control
  main.js                    Wiring de la interfaz (DOM ↔ Simulation)
```

La lógica del protocolo vive completamente en `models/` y `Simulation.js`;
`Renderer.js` y `main.js` solo leen el estado y lo pintan, por lo que el
protocolo se puede probar o reutilizar de forma independiente de la interfaz.

## Notas de implementación

- El reloj de la simulación es virtual (no depende del reloj real del
  navegador), por lo que la "Velocidad de animación" escala tiempo,
  animaciones y el temporizador de retransmisión de forma coherente.
- Los ACKs son **acumulativos**: `ACK n` confirma todo hasta `n` inclusive,
  tal como especifica Go-Back-N.
- Al vencer el timeout del paquete `base`, se retransmiten **todos** los
  paquetes entre `base` y `nextSeqNum - 1`, no solo el paquete perdido.
- En modo Half Duplex el canal solo permite un ítem en vuelo a la vez
  (en cualquier sentido); en Full Duplex, datos y ACKs pueden viajar en
  paralelo.
