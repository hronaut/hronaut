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
    },
    "conditions": {
      "visible": "visible",
      "hidden": "hidden",
      "text": "text",
      "checked": "checked",
      "unchecked": "unchecked",
      "count": "count",
      "urlPath": "urlPath"
    }
  },
  "de-DE": {
    "kinds": {
      "navigate": "Navigation",
      "click": "Klick",
      "input": "Eingabe",
      "key": "Taste",
      "scroll": "Scrollen",
      "expect": "Prüfpunkt"
    },
    "steps": {
      "open": "Öffnen: {url}",
      "navigate": "Navigieren zu {url}",
      "navigateWithin": "Innerhalb der Seite navigieren zu {url}",
      "click": "{target} anklicken",
      "input": "In {target} tippen (Wert nicht aufgezeichnet)",
      "key": "{key} in {target} drücken",
      "scroll": "Zu x={x}, y={y} scrollen",
      "expect": "Erwartetes Ergebnis: {condition}",
      "captureFailed": "Das Ziel der Aktion konnte nicht erfasst werden. Diese Aktion manuell nachbilden.",
      "captureInterrupted": "Die Erfassung der Aktion wurde durch eine Navigation unterbrochen. Diese Aktion manuell nachbilden."
    },
    "targets": {
      "input": "{type}-Eingabefeld",
      "labelled": "{kind} „{label}“"
    },
    "conditions": {
      "visible": "sichtbar",
      "hidden": "verborgen",
      "text": "exakter Text",
      "checked": "ausgewählt",
      "unchecked": "nicht ausgewählt",
      "count": "Elementanzahl",
      "urlPath": "URL-Pfad"
    }
  },
  "fr-FR": {
    "kinds": {
      "navigate": "navigation",
      "click": "clic",
      "input": "saisie",
      "key": "touche",
      "scroll": "défilement",
      "expect": "vérification"
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
      "captureFailed": "La cible de l’action n’a pas pu être capturée ; recréez cette action manuellement.",
      "captureInterrupted": "Une navigation a interrompu la capture de l’action ; recréez cette action manuellement."
    },
    "targets": {
      "input": "champ {type}",
      "labelled": "{kind} « {label} »"
    },
    "conditions": {
      "visible": "visible",
      "hidden": "masqué",
      "text": "texte exact",
      "checked": "coché",
      "unchecked": "non coché",
      "count": "nombre d’éléments",
      "urlPath": "chemin URL"
    }
  },
  "es-ES": {
    "kinds": {
      "navigate": "navegación",
      "click": "clic",
      "input": "entrada",
      "key": "tecla",
      "scroll": "desplazamiento",
      "expect": "comprobación"
    },
    "steps": {
      "open": "Abrir {url}",
      "navigate": "Ir a {url}",
      "navigateWithin": "Ir a {url} dentro de la página",
      "click": "Hacer clic en {target}",
      "input": "Escribir en {target} (valor no registrado)",
      "key": "Pulsar {key} en {target}",
      "scroll": "Desplazarse hasta x={x}, y={y}",
      "expect": "Resultado esperado: {condition}",
      "captureFailed": "No se pudo capturar el objetivo de la acción; recrea esta acción manualmente.",
      "captureInterrupted": "Una navegación interrumpió la captura de la acción; recrea esta acción manualmente."
    },
    "targets": {
      "input": "campo {type}",
      "labelled": "{kind} «{label}»"
    },
    "conditions": {
      "visible": "visible",
      "hidden": "oculto",
      "text": "texto exacto",
      "checked": "marcado",
      "unchecked": "sin marcar",
      "count": "cantidad de elementos",
      "urlPath": "ruta de URL"
    }
  },
  "pl-PL": {
    "kinds": {
      "navigate": "nawigacja",
      "click": "kliknięcie",
      "input": "wpisywanie",
      "key": "klawisz",
      "scroll": "przewijanie",
      "expect": "sprawdzenie"
    },
    "steps": {
      "open": "Otwórz {url}",
      "navigate": "Przejdź do {url}",
      "navigateWithin": "Przejdź w obrębie strony do {url}",
      "click": "Kliknij {target}",
      "input": "Wpisz w {target} (wartość nie została zarejestrowana)",
      "key": "Naciśnij {key} (cel: {target})",
      "scroll": "Przewiń do x={x}, y={y}",
      "expect": "Oczekiwany wynik: {condition}",
      "captureFailed": "Nie udało się przechwycić celu działania; odtwórz to działanie ręcznie.",
      "captureInterrupted": "Nawigacja przerwała przechwytywanie działania; odtwórz to działanie ręcznie."
    },
    "targets": {
      "input": "pole {type}",
      "labelled": "{kind} „{label}”"
    },
    "conditions": {
      "visible": "widoczny",
      "hidden": "ukryty",
      "text": "dokładny tekst",
      "checked": "zaznaczony",
      "unchecked": "niezaznaczony",
      "count": "liczba elementów",
      "urlPath": "ścieżka URL"
    }
  },
  "ru-RU": {
    "kinds": {
      "navigate": "переход",
      "click": "клик",
      "input": "ввод",
      "key": "клавиша",
      "scroll": "прокрутка",
      "expect": "проверка"
    },
    "steps": {
      "open": "Открыть {url}",
      "navigate": "Перейти на {url}",
      "navigateWithin": "Перейти в пределах страницы на {url}",
      "click": "Нажать на {target}",
      "input": "Ввести текст в {target} (значение не записано)",
      "key": "Нажать {key} в {target}",
      "scroll": "Прокрутить до x={x}, y={y}",
      "expect": "Ожидаемый результат: {condition}",
      "captureFailed": "Не удалось определить цель действия; воспроизведите это действие вручную.",
      "captureInterrupted": "Переход прервал запись действия; воспроизведите это действие вручную."
    },
    "targets": {
      "input": "поле {type}",
      "labelled": "{kind} «{label}»"
    },
    "conditions": {
      "visible": "видимый",
      "hidden": "скрытый",
      "text": "точный текст",
      "checked": "отмечено",
      "unchecked": "не отмечено",
      "count": "количество элементов",
      "urlPath": "путь URL"
    }
  },
  "uk-UA": {
    "kinds": {
      "navigate": "перехід",
      "click": "клік",
      "input": "введення",
      "key": "клавіша",
      "scroll": "прокручування",
      "expect": "перевірка"
    },
    "steps": {
      "open": "Відкрити {url}",
      "navigate": "Перейти на {url}",
      "navigateWithin": "Перейти в межах сторінки на {url}",
      "click": "Натиснути на {target}",
      "input": "Ввести текст у {target} (значення не записано)",
      "key": "Натиснути {key} (ціль: {target})",
      "scroll": "Прокрутити до x={x}, y={y}",
      "expect": "Очікуваний результат: {condition}",
      "captureFailed": "Не вдалося визначити ціль дії; відтворіть цю дію вручну.",
      "captureInterrupted": "Перехід перервав запис дії; відтворіть цю дію вручну."
    },
    "targets": {
      "input": "поле {type}",
      "labelled": "{kind} «{label}»"
    },
    "conditions": {
      "visible": "видимий",
      "hidden": "прихований",
      "text": "точний текст",
      "checked": "позначено",
      "unchecked": "не позначено",
      "count": "кількість елементів",
      "urlPath": "шлях URL"
    }
  }
}
