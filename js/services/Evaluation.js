// Evaluation.js
// Gestiona el modo de evaluación del simulador Go-Back-N.

export class Evaluation {
  constructor({ onQuestion, onResult, onFinish } = {}) {
    this.hooks = {
      onQuestion: onQuestion || (() => {}),
      onResult: onResult || (() => {}),
      onFinish: onFinish || (() => {})
    };

    this.questions = createQuestions();

    this.active = false;
    this.waitingForAnswer = false;

    this.currentQuestion = null;
    this.questionNumber = 0;

    this.score = 0;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;

    this.usedQuestionIds = new Set();

    this.lastEvent = null;
  }

  start() {
    this.active = true;
    this.waitingForAnswer = false;

    this.currentQuestion = null;
    this.questionNumber = 0;

    this.score = 0;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;

    this.usedQuestionIds.clear();
    this.lastEvent = null;

    this.hooks.onResult(this.getState());
  }

  stop() {
    this.active = false;
    this.waitingForAnswer = false;
    this.currentQuestion = null;
  }

  reset() {
    this.stop();

    this.questionNumber = 0;
    this.score = 0;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;

    this.usedQuestionIds.clear();
    this.lastEvent = null;
  }

  isActive() {
    return this.active;
  }

  isWaitingForAnswer() {
    return this.waitingForAnswer;
  }

  processEvent(event, state) {
    if (!this.active || this.waitingForAnswer || !event) {
      return null;
    }

    this.lastEvent = event;

    const question = this.findQuestion(event, state);

    if (!question) {
      return null;
    }

    this.currentQuestion = {
      ...question,
      number: this.questionNumber + 1
    };

    this.questionNumber += 1;
    this.waitingForAnswer = true;

    this.hooks.onQuestion(this.currentQuestion);

    return this.currentQuestion;
  }

  findQuestion(event, state) {
    const candidates = this.questions.filter((question) => {
      if (this.usedQuestionIds.has(question.id)) {
        return false;
      }

      if (!question.trigger.includes(event.type)) {
        return false;
      }

      if (question.condition && !question.condition(event, state)) {
        return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // Seleccionar una pregunta aleatoriamente entre las compatibles.
    const question =
      candidates[Math.floor(Math.random() * candidates.length)];

    this.usedQuestionIds.add(question.id);

    return question;
  }

  answer(option) {
    if (!this.active || !this.waitingForAnswer || !this.currentQuestion) {
      return null;
    }

    const question = this.currentQuestion;
    const correct = option === question.correctAnswer;

    if (correct) {
      this.correctAnswers += 1;
      this.score += 10;
    } else {
      this.wrongAnswers += 1;
    }

    this.waitingForAnswer = false;

    const result = {
      correct,
      selectedAnswer: option,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      score: this.score,
      correctAnswers: this.correctAnswers,
      wrongAnswers: this.wrongAnswers,
      questionNumber: this.questionNumber,
      totalQuestions: 10,
      finished: this.questionNumber >= 10
    };

    this.hooks.onResult(result);

    if (result.finished) {
      this.active = false;
      this.hooks.onFinish(this.getFinalResult());
    }

    return result;
  }

  getFinalResult() {
    const percentage =
      this.questionNumber === 0
        ? 0
        : Math.round((this.correctAnswers / this.questionNumber) * 100);

    let message = '';

    if (percentage >= 90) {
      message = 'Excelente dominio de Go-Back-N.';
    } else if (percentage >= 70) {
      message = 'Buen dominio del protocolo.';
    } else if (percentage >= 50) {
      message = 'Vas por buen camino, pero puedes reforzar algunos conceptos.';
    } else {
      message = 'Te recomendamos repasar el funcionamiento de Go-Back-N.';
    }

    return {
      score: this.score,
      correctAnswers: this.correctAnswers,
      wrongAnswers: this.wrongAnswers,
      totalQuestions: this.questionNumber,
      percentage,
      message
    };
  }

  getState() {
    return {
      active: this.active,
      waitingForAnswer: this.waitingForAnswer,
      questionNumber: this.questionNumber,
      score: this.score,
      correctAnswers: this.correctAnswers,
      wrongAnswers: this.wrongAnswers
    };
  }
}


/*
 * ============================================================
 * PREGUNTAS
 * ============================================================
 */

function createQuestions() {
  return [
    {
      id: 'loss-basic',
      trigger: ['loss'],

      question:
        'Un paquete de datos se ha perdido en el canal. ¿Qué significa esto para el protocolo Go-Back-N?',

      options: {
        A: 'El paquete se considera recibido correctamente.',
        B: 'El receptor debe aceptar automáticamente los paquetes posteriores.',
        C: 'El emisor deberá recuperar el paquete perdido mediante retransmisión.',
        D: 'La conexión termina inmediatamente.'
      },

      correctAnswer: 'C',

      explanation:
        'En Go-Back-N, si un paquete no llega correctamente, el emisor debe retransmitirlo cuando detecta la pérdida mediante el mecanismo correspondiente, normalmente un timeout.'
    },

    {
      id: 'out-of-order',
      trigger: ['discard'],

      question:
        'El receptor esperaba el Packet 2, pero recibe el Packet 3. ¿Qué debe hacer?',

      options: {
        A: 'Aceptar el Packet 3 y continuar normalmente.',
        B: 'Descartar el Packet 3 porque está fuera de orden.',
        C: 'Eliminar todos los paquetes anteriores.',
        D: 'Enviar ACK 3 inmediatamente.'
      },

      correctAnswer: 'B',

      explanation:
        'Go-Back-N utiliza recepción en orden. El receptor descarta los paquetes que llegan fuera de orden y normalmente responde con un ACK acumulativo del último paquete recibido correctamente.'
    },

    {
      id: 'duplicate-ack',
      trigger: ['ack-received'],

      condition: (event) => event.description.includes('duplicado'),

      question:
        'El emisor recibe un ACK duplicado. ¿Qué indica normalmente este comportamiento?',

      options: {
        A: 'Que todos los paquetes fueron recibidos correctamente.',
        B: 'Que el receptor sigue esperando un paquete anterior.',
        C: 'Que la ventana ya terminó.',
        D: 'Que el emisor debe cerrar la conexión.'
      },

      correctAnswer: 'B',

      explanation:
        'Un ACK duplicado puede aparecer cuando el receptor recibe un paquete fuera de orden. El receptor vuelve a confirmar el último paquete recibido correctamente porque todavía espera el siguiente.'
    },

    {
      id: 'timeout',
      trigger: ['timeout'],

      question:
        'Se produce un timeout del Packet base. ¿Qué acción caracteriza a Go-Back-N?',

      options: {
        A: 'Retransmitir solamente el último paquete enviado.',
        B: 'Retransmitir todos los paquetes pendientes desde el base.',
        C: 'Eliminar todos los ACK.',
        D: 'Mover la ventana hasta el último paquete enviado.'
      },

      correctAnswer: 'B',

      explanation:
        'Cuando expira el temporizador del paquete base, Go-Back-N retransmite los paquetes pendientes desde base hasta nextSeqNum - 1.'
    },

    {
      id: 'retransmission',
      trigger: ['retransmit'],

      question:
        'El emisor está retransmitiendo varios paquetes después de un timeout. ¿Por qué puede retransmitir paquetes que aparentemente ya habían sido enviados?',

      options: {
        A: 'Porque Go-Back-N retransmite la ventana pendiente desde el paquete base.',
        B: 'Porque todos los paquetes anteriores siempre se consideran perdidos.',
        C: 'Porque el receptor nunca puede enviar ACK.',
        D: 'Porque cada paquete debe enviarse exactamente tres veces.'
      },

      correctAnswer: 'A',

      explanation:
        'Una característica de Go-Back-N es que ante un timeout del paquete base se retransmiten los paquetes no confirmados que siguen dentro de la ventana.'
    },

    {
      id: 'ack-cumulative',
      trigger: ['ack-received'],

      condition: (event) =>
        event.description.includes('ventana avanza'),

      question:
        'El emisor recibe un ACK y la ventana avanza. ¿Qué significa un ACK acumulativo en Go-Back-N?',

      options: {
        A: 'Confirma únicamente el paquete indicado.',
        B: 'Confirma todos los paquetes hasta el número indicado.',
        C: 'Indica que el canal está en Half Duplex.',
        D: 'Indica que el paquete indicado se perdió.'
      },

      correctAnswer: 'B',

      explanation:
        'Los ACK de Go-Back-N son acumulativos. Un ACK n confirma la recepción correcta de los paquetes hasta n inclusive.'
    },

    {
      id: 'window',
      trigger: ['send'],

      condition: (event, state) =>
        state &&
        state.window &&
        state.window.nextSeqNum - state.window.base > 1,

      question:
        'Hay varios paquetes enviados dentro de la ventana y algunos todavía no han sido confirmados. ¿Qué permite esto?',

      options: {
        A: 'Enviar varios paquetes sin esperar un ACK individual por cada uno.',
        B: 'Enviar paquetes fuera de la ventana indefinidamente.',
        C: 'Evitar completamente los ACK.',
        D: 'Garantizar que nunca habrá pérdidas.'
      },

      correctAnswer: 'A',

      explanation:
        'La ventana deslizante permite tener varios paquetes en tránsito antes de recibir sus confirmaciones, aprovechando mejor el canal.'
    },

    {
      id: 'half-duplex',
      trigger: ['info'],

      condition: (event) =>
        event.description.includes('Half Duplex'),

      question:
        'La simulación ha cambiado a Half Duplex. ¿Qué característica tiene este modo en el simulador?',

      options: {
        A: 'Datos y ACK pueden viajar simultáneamente.',
        B: 'Solo puede existir un elemento en tránsito a la vez.',
        C: 'Los ACK dejan de existir.',
        D: 'Los paquetes se envían automáticamente.'
      },

      correctAnswer: 'B',

      explanation:
        'En el simulador, Half Duplex permite un único elemento en vuelo a la vez, independientemente de si se trata de datos o de un ACK.'
    },

    {
      id: 'full-duplex',
      trigger: ['info'],

      condition: (event) =>
        event.description.includes('Full Duplex'),

      question:
        'La simulación está en Full Duplex. ¿Qué ventaja tiene este modo frente a Half Duplex?',

      options: {
        A: 'No necesita ACK.',
        B: 'Permite que datos y ACK viajen en paralelo.',
        C: 'Elimina el timeout.',
        D: 'Evita todas las pérdidas.'
      },

      correctAnswer: 'B',

      explanation:
        'En Full Duplex, el canal permite tráfico simultáneo en ambos sentidos, por lo que un paquete de datos y un ACK pueden estar viajando al mismo tiempo.'
    },

    {
      id: 'receive',
      trigger: ['receive'],

      question:
        'El receptor recibe correctamente el paquete que estaba esperando. ¿Qué debería ocurrir después?',

      options: {
        A: 'El receptor lo descarta.',
        B: 'El receptor actualiza el siguiente número esperado y genera un ACK.',
        C: 'El emisor reinicia la ventana.',
        D: 'Se produce automáticamente un timeout.'
      },

      correctAnswer: 'B',

      explanation:
        'Cuando el receptor obtiene el paquete esperado, lo acepta, avanza su número esperado y envía el ACK correspondiente.'
    }
  ];
}