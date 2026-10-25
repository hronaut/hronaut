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
  },
  "it-IT": {
    "kinds": {
      "navigate": "navigazione",
      "click": "clic",
      "input": "inserimento",
      "key": "tasto",
      "scroll": "scorrimento",
      "expect": "verifica"
    },
    "steps": {
      "open": "Apri {url}",
      "navigate": "Vai a {url}",
      "navigateWithin": "Vai a {url} all’interno della pagina",
      "click": "Fai clic su {target}",
      "input": "Digita in {target} (valore non registrato)",
      "key": "Premi {key} su {target}",
      "scroll": "Scorri fino a x={x}, y={y}",
      "expect": "Risultato previsto: {condition}",
      "captureFailed": "Impossibile acquisire la destinazione dell’azione; ricrea questa azione manualmente.",
      "captureInterrupted": "Acquisizione dell’azione interrotta dalla navigazione; ricrea questa azione manualmente."
    },
    "targets": {
      "input": "campo {type}",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "visibile",
      "hidden": "nascosto",
      "text": "testo",
      "checked": "selezionato",
      "unchecked": "non selezionato",
      "count": "conteggio",
      "urlPath": "percorso URL"
    }
  },
  "pt-BR": {
    "kinds": {
      "navigate": "navegar",
      "click": "clicar",
      "input": "digitar",
      "key": "tecla",
      "scroll": "rolar",
      "expect": "esperar"
    },
    "steps": {
      "open": "Abrir {url}",
      "navigate": "Navegar para {url}",
      "navigateWithin": "Navegar dentro da página para {url}",
      "click": "Clicar em {target}",
      "input": "Digitar em {target} (valor não gravado)",
      "key": "Pressionar {key} em {target}",
      "scroll": "Rolar até x={x}, y={y}",
      "expect": "Resultado esperado: {condition}",
      "captureFailed": "Não foi possível capturar o alvo da ação; recrie esta ação manualmente.",
      "captureInterrupted": "A captura da ação foi interrompida por uma navegação; recrie esta ação manualmente."
    },
    "targets": {
      "input": "campo {type}",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "visível",
      "hidden": "oculto",
      "text": "texto",
      "checked": "marcado",
      "unchecked": "desmarcado",
      "count": "contagem",
      "urlPath": "caminho do URL"
    }
  },
  "tr-TR": {
    "kinds": {
      "navigate": "gezinme",
      "click": "tıklama",
      "input": "giriş",
      "key": "tuş",
      "scroll": "kaydırma",
      "expect": "beklenti"
    },
    "steps": {
      "open": "{url} adresini açın",
      "navigate": "{url} adresine gidin",
      "navigateWithin": "Sayfa içinde {url} adresine gidin",
      "click": "{target} öğesini tıklayın",
      "input": "{target} alanına yazın (değer kaydedilmedi)",
      "key": "{target} üzerinde {key} tuşuna basın",
      "scroll": "x={x}, y={y} konumuna kaydırın",
      "expect": "Beklenen sonuç: {condition}",
      "captureFailed": "Eylemin hedefi yakalanamadı; bu eylemi elle yeniden oluşturun.",
      "captureInterrupted": "Eylem yakalama bir gezinme nedeniyle kesildi; bu eylemi elle yeniden oluşturun."
    },
    "targets": {
      "input": "{type} girişi",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "görünür",
      "hidden": "gizli",
      "text": "metin",
      "checked": "işaretli",
      "unchecked": "işaretsiz",
      "count": "sayı",
      "urlPath": "URL yolu"
    }
  },
  "hi-IN": {
    "kinds": {
      "navigate": "नेविगेशन",
      "click": "क्लिक",
      "input": "इनपुट",
      "key": "कुंजी",
      "scroll": "स्क्रोल",
      "expect": "जांच बिंदु"
    },
    "steps": {
      "open": "{url} खोलें",
      "navigate": "{url} पर जाएं",
      "navigateWithin": "पेज के अंदर {url} पर जाएं",
      "click": "{target} पर क्लिक करें",
      "input": "{target} में टाइप करें (वैल्यू रिकॉर्ड नहीं की गई)",
      "key": "{target} पर {key} दबाएं",
      "scroll": "x={x}, y={y} तक स्क्रोल करें",
      "expect": "अनुमानित नतीजा: {condition}",
      "captureFailed": "कार्रवाई का टारगेट कैप्चर नहीं किया जा सका; इस कार्रवाई को मैन्युअल रूप से फिर से बनाएं।",
      "captureInterrupted": "नेविगेशन की वजह से कार्रवाई का कैप्चर बीच में रुक गया; इस कार्रवाई को मैन्युअल रूप से फिर से बनाएं।"
    },
    "targets": {
      "input": "{type} इनपुट",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "दिख रहा है",
      "hidden": "छिपा है",
      "text": "सटीक टेक्स्ट",
      "checked": "चुना गया",
      "unchecked": "नहीं चुना गया",
      "count": "एलिमेंट की संख्या",
      "urlPath": "URL पाथ"
    }
  },
  "ja-JP": {
    "kinds": {
      "navigate": "ナビゲーション",
      "click": "クリック",
      "input": "入力",
      "key": "キー",
      "scroll": "スクロール",
      "expect": "確認"
    },
    "steps": {
      "open": "{url} を開く",
      "navigate": "{url} に移動",
      "navigateWithin": "ページ内で {url} に移動",
      "click": "{target} をクリック",
      "input": "{target} に入力（値は記録されていません）",
      "key": "{target} で {key} を押す",
      "scroll": "x={x}, y={y} までスクロール",
      "expect": "期待される結果：{condition}",
      "captureFailed": "操作の対象を記録できませんでした。この操作は手動で再現してください。",
      "captureInterrupted": "ページの移動によって操作の記録が中断されました。この操作は手動で再現してください。"
    },
    "targets": {
      "input": "{type} 入力欄",
      "labelled": "{kind}「{label}」"
    },
    "conditions": {
      "visible": "表示",
      "hidden": "非表示",
      "text": "テキスト",
      "checked": "チェックあり",
      "unchecked": "チェックなし",
      "count": "要素数",
      "urlPath": "URL パス"
    }
  },
  "ko-KR": {
    "kinds": {
      "navigate": "이동",
      "click": "클릭",
      "input": "입력",
      "key": "키",
      "scroll": "스크롤",
      "expect": "확인"
    },
    "steps": {
      "open": "{url} 열기",
      "navigate": "{url}(으)로 이동",
      "navigateWithin": "페이지 안에서 {url}(으)로 이동",
      "click": "{target} 클릭",
      "input": "{target}에 입력(값은 기록되지 않음)",
      "key": "{target}에서 {key} 누르기",
      "scroll": "x={x}, y={y} 위치로 스크롤",
      "expect": "예상 결과: {condition}",
      "captureFailed": "작업 대상을 캡처할 수 없습니다. 이 작업을 직접 다시 만드세요.",
      "captureInterrupted": "페이지 이동으로 작업 캡처가 중단되었습니다. 이 작업을 직접 다시 만드세요."
    },
    "targets": {
      "input": "{type} 입력란",
      "labelled": "{kind} ‘{label}’"
    },
    "conditions": {
      "visible": "표시됨",
      "hidden": "숨겨짐",
      "text": "텍스트",
      "checked": "선택됨",
      "unchecked": "선택 해제됨",
      "count": "개수",
      "urlPath": "URL 경로"
    }
  },
  "zh-CN": {
    "kinds": {
      "navigate": "导航",
      "click": "点击",
      "input": "输入",
      "key": "按键",
      "scroll": "滚动",
      "expect": "预期"
    },
    "steps": {
      "open": "打开 {url}",
      "navigate": "导航到 {url}",
      "navigateWithin": "在页面内导航到 {url}",
      "click": "点击 {target}",
      "input": "在 {target} 中输入（未记录值）",
      "key": "在 {target} 上按 {key}",
      "scroll": "滚动到 x={x}, y={y}",
      "expect": "预期结果：{condition}",
      "captureFailed": "无法捕获操作目标；请手动重新创建此操作。",
      "captureInterrupted": "操作捕获被导航中断；请手动重新创建此操作。"
    },
    "targets": {
      "input": "{type} 输入框",
      "labelled": "{kind}“{label}”"
    },
    "conditions": {
      "visible": "可见",
      "hidden": "隐藏",
      "text": "文本",
      "checked": "已选中",
      "unchecked": "未选中",
      "count": "数量",
      "urlPath": "网址路径"
    }
  },
  "zh-TW": {
    "kinds": {
      "navigate": "導覽",
      "click": "點擊",
      "input": "輸入",
      "key": "按鍵",
      "scroll": "捲動",
      "expect": "檢查點"
    },
    "steps": {
      "open": "開啟 {url}",
      "navigate": "前往 {url}",
      "navigateWithin": "在頁面內前往 {url}",
      "click": "點擊 {target}",
      "input": "在 {target} 中輸入（未記錄輸入值）",
      "key": "在 {target} 上按下 {key}",
      "scroll": "捲動至 x={x}, y={y}",
      "expect": "預期結果：{condition}",
      "captureFailed": "無法擷取動作目標，請手動重新建立這個動作。",
      "captureInterrupted": "動作擷取因導覽而中斷，請手動重新建立這個動作。"
    },
    "targets": {
      "input": "{type} 輸入欄位",
      "labelled": "{kind}「{label}」"
    },
    "conditions": {
      "visible": "可見",
      "hidden": "隱藏",
      "text": "文字",
      "checked": "已勾選",
      "unchecked": "未勾選",
      "count": "數量",
      "urlPath": "URL 路徑"
    }
  },
  "id-ID": {
    "kinds": {
      "navigate": "navigasi",
      "click": "klik",
      "input": "input",
      "key": "tombol",
      "scroll": "gulir",
      "expect": "ekspektasi"
    },
    "steps": {
      "open": "Buka {url}",
      "navigate": "Navigasi ke {url}",
      "navigateWithin": "Navigasi di dalam halaman ke {url}",
      "click": "Klik {target}",
      "input": "Ketik di {target} (nilai tidak direkam)",
      "key": "Tekan {key} di {target}",
      "scroll": "Gulir ke x={x}, y={y}",
      "expect": "Hasil yang diharapkan: {condition}",
      "captureFailed": "Target tindakan tidak dapat direkam; buat ulang tindakan ini secara manual.",
      "captureInterrupted": "Perekaman tindakan terganggu oleh navigasi; buat ulang tindakan ini secara manual."
    },
    "targets": {
      "input": "input {type}",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "terlihat",
      "hidden": "tersembunyi",
      "text": "teks",
      "checked": "dicentang",
      "unchecked": "tidak dicentang",
      "count": "jumlah",
      "urlPath": "urlPath"
    }
  },
  "vi-VN": {
    "kinds": {
      "navigate": "điều hướng",
      "click": "nhấp",
      "input": "nhập",
      "key": "phím",
      "scroll": "cuộn",
      "expect": "kỳ vọng"
    },
    "steps": {
      "open": "Mở {url}",
      "navigate": "Điều hướng đến {url}",
      "navigateWithin": "Điều hướng trong trang đến {url}",
      "click": "Nhấp vào {target}",
      "input": "Nhập vào {target} (không ghi lại giá trị)",
      "key": "Nhấn {key} trên {target}",
      "scroll": "Cuộn đến x={x}, y={y}",
      "expect": "Kết quả mong đợi: {condition}",
      "captureFailed": "Không thể ghi lại mục tiêu của thao tác; hãy tạo lại thao tác này theo cách thủ công.",
      "captureInterrupted": "Việc ghi lại thao tác bị gián đoạn do điều hướng; hãy tạo lại thao tác này theo cách thủ công."
    },
    "targets": {
      "input": "trường nhập {type}",
      "labelled": "{kind} “{label}”"
    },
    "conditions": {
      "visible": "hiển thị",
      "hidden": "ẩn",
      "text": "văn bản",
      "checked": "đã đánh dấu",
      "unchecked": "chưa đánh dấu",
      "count": "số lượng",
      "urlPath": "đường dẫn URL"
    }
  },
}
