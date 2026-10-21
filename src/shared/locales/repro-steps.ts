// Repro recorder step names and sentences; src/shared/repro-step-text.ts holds the English that main writes.
export const reproStepMessages = {
  "en-US": {
    "kinds": {
      "navigate": "navigate",
      "click": "click",
      "input": "input",
      "key": "key",
      "scroll": "scroll",
      "expect": "expect"
    },
    "steps": {
      "open": "Open {url}",
      "navigate": "Navigate to {url}",
      "navigateWithin": "Navigate within the page to {url}",
      "click": "Click {target}",
      "input": "Type in {target} (value not recorded)",
      "key": "Press {key} on {target}",
      "scroll": "Scroll to x={x}, y={y}",
      "expect": "Expected result: {condition}",
      "captureFailed": "Action target could not be captured; recreate this action manually.",
      "captureInterrupted": "Action capture interrupted by navigation; recreate this action manually."
    },
    "targets": {
      "input": "{type} input",
      "labelled": "{kind} “{label}”"
    }
  },
  "de-DE": {
    "kinds": {
      "navigate": "Navigation",
      "click": "Klick",
      "input": "Eingabe",
      "key": "Taste",
      "scroll": "Scrollen",
      "expect": "Erwartung"
    },
    "steps": {
      "open": "{url} öffnen",
      "navigate": "Zu {url} navigieren",
      "navigateWithin": "Innerhalb der Seite zu {url} navigieren",
      "click": "{target} anklicken",
      "input": "In {target} tippen (Wert nicht aufgezeichnet)",
      "key": "{key} in {target} drücken",
      "scroll": "Zu x={x}, y={y} scrollen",
      "expect": "Erwartetes Ergebnis: {condition}",
      "captureFailed": "Das Ziel der Aktion konnte nicht erfasst werden. Diese Aktion manuell nachstellen.",
      "captureInterrupted": "Die Erfassung der Aktion wurde durch eine Navigation unterbrochen. Diese Aktion manuell nachstellen."
    },
    "targets": {
      "input": "Eingabefeld ({type})",
      "labelled": "{kind} „{label}“"
    }
  },
  "fr-FR": {
    "kinds": {
      "navigate": "navigation",
      "click": "clic",
      "input": "saisie",
      "key": "touche",
      "scroll": "défilement",
      "expect": "attente"
    },
    "steps": {
      "open": "Ouvrir {url}",
      "navigate": "Naviguer vers {url}",
      "navigateWithin": "Naviguer dans la page vers {url}",
      "click": "Cliquer sur {target}",
      "input": "Saisir dans {target} (valeur non enregistrée)",
      "key": "Appuyer sur {key} dans {target}",
      "scroll": "Faire défiler jusqu’à x={x}, y={y}",
      "expect": "Résultat attendu : {condition}",
      "captureFailed": "La cible de l’action n’a pas pu être capturée ; refaites cette action manuellement.",
      "captureInterrupted": "Une navigation a interrompu la capture de l’action ; refaites cette action manuellement."
    },
    "targets": {
      "input": "champ {type}",
      "labelled": "{kind} « {label} »"
    }
  },
  "es-ES": {
    "kinds": {
      "navigate": "navegación",
      "click": "clic",
      "input": "entrada",
      "key": "tecla",
      "scroll": "desplazamiento",
      "expect": "expectativa"
    },
    "steps": {
      "open": "Abrir {url}",
      "navigate": "Ir a {url}",
      "navigateWithin": "Ir dentro de la página a {url}",
      "click": "Hacer clic en {target}",
      "input": "Escribir en {target} (valor no registrado)",
      "key": "Pulsar {key} en {target}",
      "scroll": "Desplazarse a x={x}, y={y}",
      "expect": "Resultado esperado: {condition}",
      "captureFailed": "No se pudo capturar el destino de la acción; repite esta acción manualmente.",
      "captureInterrupted": "Una navegación interrumpió la captura de la acción; repite esta acción manualmente."
    },
    "targets": {
      "input": "campo {type}",
      "labelled": "{kind} «{label}»"
    }
  },
  "pl-PL": {
    "kinds": {
      "navigate": "nawigacja",
      "click": "kliknięcie",
      "input": "wpisywanie",
      "key": "klawisz",
      "scroll": "przewijanie",
      "expect": "oczekiwanie"
    },
    "steps": {
      "open": "Otwórz {url}",
      "navigate": "Przejdź do {url}",
      "navigateWithin": "Przejdź w obrębie strony do {url}",
      "click": "Kliknij {target}",
      "input": "Wpisz w {target} (wartość nie została zapisana)",
      "key": "Naciśnij {key} w {target}",
      "scroll": "Przewiń do x={x}, y={y}",
      "expect": "Oczekiwany wynik: {condition}",
      "captureFailed": "Nie udało się przechwycić celu akcji; odtwórz tę akcję ręcznie.",
      "captureInterrupted": "Nawigacja przerwała przechwytywanie akcji; odtwórz tę akcję ręcznie."
    },
    "targets": {
      "input": "pole {type}",
      "labelled": "{kind} „{label}”"
    }
  },
  "ru-RU": {
    "kinds": {
      "navigate": "переход",
      "click": "клик",
      "input": "ввод",
      "key": "клавиша",
      "scroll": "прокрутка",
      "expect": "ожидание"
    },
    "steps": {
      "open": "Открыть {url}",
      "navigate": "Перейти на {url}",
      "navigateWithin": "Перейти внутри страницы на {url}",
      "click": "Нажать на {target}",
      "input": "Ввести в {target} (значение не записано)",
      "key": "Нажать {key} в {target}",
      "scroll": "Прокрутить до x={x}, y={y}",
      "expect": "Ожидаемый результат: {condition}",
      "captureFailed": "Не удалось определить цель действия; повторите это действие вручную.",
      "captureInterrupted": "Переход прервал запись действия; повторите это действие вручную."
    },
    "targets": {
      "input": "поле {type}",
      "labelled": "{kind} «{label}»"
    }
  },
  "uk-UA": {
    "kinds": {
      "navigate": "перехід",
      "click": "клік",
      "input": "введення",
      "key": "клавіша",
      "scroll": "прокручування",
      "expect": "очікування"
    },
    "steps": {
      "open": "Відкрити {url}",
      "navigate": "Перейти на {url}",
      "navigateWithin": "Перейти в межах сторінки на {url}",
      "click": "Натиснути на {target}",
      "input": "Ввести в {target} (значення не записано)",
      "key": "Натиснути {key} у {target}",
      "scroll": "Прокрутити до x={x}, y={y}",
      "expect": "Очікуваний результат: {condition}",
      "captureFailed": "Не вдалося визначити ціль дії; повторіть цю дію вручну.",
      "captureInterrupted": "Перехід перервав запис дії; повторіть цю дію вручну."
    },
    "targets": {
      "input": "поле {type}",
      "labelled": "{kind} «{label}»"
    }
  }
}
