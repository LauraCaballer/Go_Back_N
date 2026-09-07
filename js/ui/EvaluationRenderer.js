// EvaluationRenderer.js

export function renderEvaluationQuestion(panel, question, state) {
  panel.hidden = false;

  panel.innerHTML = `
    <div class="evaluation__header">
      <div>
        <span class="evaluation__eyebrow">EVALUACIÓN</span>
        <h2>🧠 Pregunta ${question.number} de 10</h2>
      </div>

      <div class="evaluation__score">
        <span>PUNTOS</span>
        <strong>${state.score}</strong>
      </div>
    </div>

    <div class="evaluation__question">
      ${question.question}
    </div>

    <div class="evaluation__options">
      ${Object.entries(question.options)
        .map(
          ([letter, text]) => `
            <button
              class="evaluation-option"
              type="button"
              data-answer="${letter}"
            >
              <span class="evaluation-option__letter">${letter}</span>
              <span class="evaluation-option__text">${text}</span>
            </button>
          `
        )
        .join('')}
    </div>

    <div class="evaluation__actions">
      <button
        class="btn btn--primary"
        id="evaluationAnswerBtn"
        disabled
      >
        Responder
      </button>
    </div>
  `;

  const optionButtons = panel.querySelectorAll('.evaluation-option');
  const answerButton = panel.querySelector('#evaluationAnswerBtn');

  let selectedAnswer = null;

  optionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      optionButtons.forEach((item) =>
        item.classList.remove('is-selected')
      );

      button.classList.add('is-selected');

      selectedAnswer = button.dataset.answer;
      answerButton.disabled = false;
    });
  });

  answerButton.addEventListener('click', () => {
    if (!selectedAnswer) return;

    panel.dispatchEvent(
      new CustomEvent('evaluation-answer', {
        detail: {
          answer: selectedAnswer
        }
      })
    );
  });
}


export function renderEvaluationResult(panel, result) {
  const resultClass = result.correct ? 'is-correct' : 'is-wrong';

  panel.querySelector('.evaluation__options')?.remove();

  const actions = panel.querySelector('.evaluation__actions');

  if (actions) {
    actions.innerHTML = `
      <div class="evaluation-feedback ${resultClass}">
        <div class="evaluation-feedback__title">
          ${result.correct ? '✓ ¡Correcto!' : '✗ Respuesta incorrecta'}
        </div>

        <p>
          ${
            result.correct
              ? 'Has identificado correctamente lo que está ocurriendo en la simulación.'
              : `La respuesta correcta era <strong>${result.correctAnswer}</strong>.`
          }
        </p>

        <div class="evaluation-feedback__explanation">
          ${result.explanation}
        </div>
      </div>

      <button
        class="btn btn--primary"
        id="evaluationContinueBtn"
      >
        ${
          result.finished
            ? 'Ver resultado final'
            : '▶ Continuar simulación'
        }
      </button>
    `;

    panel.querySelector('#evaluationContinueBtn').addEventListener(
      'click',
      () => {
        panel.dispatchEvent(
          new CustomEvent('evaluation-continue', {
            detail: {
              finished: result.finished
            }
          })
        );
      }
    );
  }
}


export function renderEvaluationFinal(panel, result) {
  panel.hidden = false;

  let icon = '🎓';

  if (result.percentage >= 90) {
    icon = '🏆';
  } else if (result.percentage >= 70) {
    icon = '⭐';
  } else if (result.percentage >= 50) {
    icon = '📚';
  }

  panel.innerHTML = `
    <div class="evaluation-final">
      <div class="evaluation-final__icon">${icon}</div>

      <span class="evaluation__eyebrow">
        EVALUACIÓN COMPLETADA
      </span>

      <h2>Resultado final</h2>

      <div class="evaluation-final__score">
        ${result.score}
        <span>/ 100</span>
      </div>

      <div class="evaluation-final__percentage">
        ${result.percentage}%
      </div>

      <p class="evaluation-final__message">
        ${result.message}
      </p>

      <div class="evaluation-final__stats">
        <div>
          <strong>${result.correctAnswers}</strong>
          <span>Correctas</span>
        </div>

        <div>
          <strong>${result.wrongAnswers}</strong>
          <span>Incorrectas</span>
        </div>

        <div>
          <strong>${result.totalQuestions}</strong>
          <span>Preguntas</span>
        </div>
      </div>

      <button
        class="btn btn--primary"
        id="evaluationRestartBtn"
      >
        🔄 Nueva evaluación
      </button>
    </div>
  `;

  panel.querySelector('#evaluationRestartBtn').addEventListener(
    'click',
    () => {
      panel.dispatchEvent(
        new CustomEvent('evaluation-restart')
      );
    }
  );
}