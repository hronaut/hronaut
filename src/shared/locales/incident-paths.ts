export const incidentPathMessages = {
  'en-US': {
    addPath: 'Omit one property',
    removePath: 'Remove property omission {index}',
    pathRow: 'Property omission {index}',
    pathArtifact: 'Artifact',
    pathValue: 'Exact property path (JSON array)',
    pathHint: 'Up to 10 paths, with 16 segments each. Example: ["console", 0, "message"]. Strings select object keys; numbers traverse arrays. Array elements cannot be removed. Paths must match before global field omissions and text replacements.',
    invalidPath: 'Property omission {index} needs a valid literal path.'
  },
  'ru-RU': {
    addPath: 'Исключить одно свойство',
    removePath: 'Удалить исключение свойства {index}',
    pathRow: 'Исключение свойства {index}',
    pathArtifact: 'Артефакт',
    pathValue: 'Точный путь к свойству (массив JSON)',
    pathHint: 'До 10 путей по 16 сегментов. Пример: ["console", 0, "message"]. Строки выбирают ключи объектов, числа — индексы массивов. Элементы массивов не удаляются. Пути проверяются до глобальных исключений полей и замен текста.',
    invalidPath: 'Для исключения свойства {index} нужен корректный буквальный путь.'
  },
  'uk-UA': {
    addPath: 'Вилучити одну властивість',
    removePath: 'Прибрати вилучення властивості {index}',
    pathRow: 'Вилучення властивості {index}',
    pathArtifact: 'Артефакт',
    pathValue: 'Точний шлях до властивості (масив JSON)',
    pathHint: 'До 10 шляхів по 16 сегментів. Приклад: ["console", 0, "message"]. Рядки вибирають ключі об’єктів, числа — індекси масивів. Елементи масивів не вилучаються. Шляхи перевіряються до глобальних вилучень полів і замін тексту.',
    invalidPath: 'Для вилучення властивості {index} потрібен коректний буквальний шлях.'
  },
  'de-DE': {
    addPath: 'Eine Eigenschaft auslassen',
    removePath: 'Eigenschaftsauslassung {index} entfernen',
    pathRow: 'Eigenschaftsauslassung {index}',
    pathArtifact: 'Artefakt',
    pathValue: 'Exakter Eigenschaftspfad (JSON-Array)',
    pathHint: 'Bis zu 10 Pfade mit je 16 Segmenten. Beispiel: ["console", 0, "message"]. Zeichenfolgen wählen Objektschlüssel, Zahlen durchlaufen Arrays. Array-Elemente werden nicht entfernt. Pfade müssen vor globalen Feldauslassungen und Textersetzungen passen.',
    invalidPath: 'Eigenschaftsauslassung {index} benötigt einen gültigen literalen Pfad.'
  },
  'es-ES': {
    addPath: 'Omitir una propiedad',
    removePath: 'Quitar omisión de propiedad {index}',
    pathRow: 'Omisión de propiedad {index}',
    pathArtifact: 'Artefacto',
    pathValue: 'Ruta exacta de propiedad (array JSON)',
    pathHint: 'Hasta 10 rutas de 16 segmentos. Ejemplo: ["console", 0, "message"]. Las cadenas seleccionan claves y los números recorren arrays. No se eliminan elementos de arrays. Las rutas deben coincidir antes de las omisiones globales y sustituciones de texto.',
    invalidPath: 'La omisión de propiedad {index} necesita una ruta literal válida.'
  },
  'fr-FR': {
    addPath: 'Omettre une propriété',
    removePath: 'Retirer l’omission de propriété {index}',
    pathRow: 'Omission de propriété {index}',
    pathArtifact: 'Artefact',
    pathValue: 'Chemin exact de propriété (tableau JSON)',
    pathHint: 'Jusqu’à 10 chemins de 16 segments. Exemple : ["console", 0, "message"]. Les chaînes sélectionnent les clés, les nombres parcourent les tableaux. Les éléments de tableau ne sont pas supprimés. Les chemins doivent correspondre avant les omissions globales et remplacements de texte.',
    invalidPath: 'L’omission de propriété {index} nécessite un chemin littéral valide.'
  },
  'pl-PL': {
    addPath: 'Pomiń jedną właściwość',
    removePath: 'Usuń pominięcie właściwości {index}',
    pathRow: 'Pominięcie właściwości {index}',
    pathArtifact: 'Artefakt',
    pathValue: 'Dokładna ścieżka właściwości (tablica JSON)',
    pathHint: 'Do 10 ścieżek po 16 segmentów. Przykład: ["console", 0, "message"]. Ciągi wybierają klucze obiektów, liczby indeksy tablic. Elementy tablic nie są usuwane. Ścieżki muszą pasować przed globalnym pomijaniem pól i zamianą tekstu.',
    invalidPath: 'Pominięcie właściwości {index} wymaga poprawnej ścieżki dosłownej.'
  },
  'it-IT': {
    addPath: 'Ometti una proprietà',
    removePath: 'Rimuovi omissione della proprietà {index}',
    pathRow: 'Omissione della proprietà {index}',
    pathArtifact: 'Artefatto',
    pathValue: 'Percorso esatto della proprietà (array JSON)',
    pathHint: 'Fino a 10 percorsi, con 16 segmenti ciascuno. Esempio: ["console", 0, "message"]. Le stringhe selezionano le chiavi degli oggetti; i numeri attraversano gli array. Gli elementi degli array non possono essere rimossi. I percorsi devono corrispondere prima delle omissioni globali dei campi e delle sostituzioni di testo.',
    invalidPath: 'L’omissione della proprietà {index} richiede un percorso letterale valido.'
  },
  'pt-BR': {
    addPath: 'Omitir uma propriedade',
    removePath: 'Remover a omissão de propriedade {index}',
    pathRow: 'Omissão de propriedade {index}',
    pathArtifact: 'Artefato',
    pathValue: 'Caminho exato da propriedade (array JSON)',
    pathHint: 'Até 10 caminhos, com 16 segmentos cada. Exemplo: ["console", 0, "message"]. Strings selecionam chaves de objetos; números percorrem arrays. Elementos de arrays não podem ser removidos. Os caminhos precisam corresponder antes das omissões globais de campos e das substituições de texto.',
    invalidPath: 'A omissão de propriedade {index} precisa de um caminho literal válido.'
  },
  'tr-TR': {
    addPath: 'Bir özelliği çıkar',
    removePath: '{index} numaralı özellik çıkarmayı kaldır',
    pathRow: 'Özellik çıkarma {index}',
    pathArtifact: 'Öğe',
    pathValue: 'Tam özellik yolu (JSON dizisi)',
    pathHint: 'Her biri en fazla 16 bölümlü, en fazla 10 yol. Örnek: ["console", 0, "message"]. Dizeler nesne anahtarlarını seçer; sayılar dizilerde ilerler. Dizi öğeleri kaldırılamaz. Yollar, genel alan çıkarmaları ve metin değiştirmelerinden önce eşleşmelidir.',
    invalidPath: '{index} numaralı özellik çıkarma için geçerli bir değişmez yol gerekiyor.'
  },
  'hi-IN': {
    addPath: 'एक प्रॉपर्टी छोड़ें',
    removePath: 'प्रॉपर्टी छोड़ने वाला नियम {index} हटाएं',
    pathRow: 'प्रॉपर्टी छोड़ने वाला नियम {index}',
    pathArtifact: 'आर्टफ़ैक्ट',
    pathValue: 'प्रॉपर्टी का सटीक पाथ (JSON array)',
    pathHint: 'ज़्यादा से ज़्यादा 10 पाथ, हर पाथ में 16 सेगमेंट। उदाहरण: ["console", 0, "message"]। स्ट्रिंग से ऑब्जेक्ट की कुंजियां चुनी जाती हैं; संख्याओं से array में आगे बढ़ा जाता है। array के एलिमेंट हटाए नहीं जा सकते। ग्लोबल फ़ील्ड छोड़ने और टेक्स्ट बदलने से पहले पाथ का मेल खाना ज़रूरी है।',
    invalidPath: 'प्रॉपर्टी छोड़ने वाले नियम {index} के लिए मान्य लिटरल पाथ ज़रूरी है।'
  },
  'ja-JP': {
    addPath: 'プロパティを 1 つ除外',
    removePath: 'プロパティの除外 {index} を削除',
    pathRow: 'プロパティの除外 {index}',
    pathArtifact: 'アーティファクト',
    pathValue: '正確なプロパティのパス（JSON 配列）',
    pathHint: '最大 10 個のパス、各パス最大 16 セグメントまで。例：["console", 0, "message"]。文字列はオブジェクトのキーを選択し、数値は配列をたどります。配列の要素は削除できません。パスは、全体のフィールドの除外とテキストの置換の前に一致している必要があります。',
    invalidPath: 'プロパティの除外 {index} には、有効なリテラル パスが必要です。'
  },
  'ko-KR': {
    addPath: '속성 하나 생략',
    removePath: '속성 생략 {index} 삭제',
    pathRow: '속성 생략 {index}',
    pathArtifact: '아티팩트',
    pathValue: '정확한 속성 경로(JSON 배열)',
    pathHint: '경로는 최대 10개, 경로마다 세그먼트는 최대 16개입니다. 예: ["console", 0, "message"]. 문자열은 객체 키를 선택하고 숫자는 배열을 탐색합니다. 배열 요소는 삭제할 수 없습니다. 경로는 전역 필드 생략 및 텍스트 바꾸기보다 먼저 일치해야 합니다.',
    invalidPath: '속성 생략 {index}에 유효한 리터럴 경로가 필요합니다.'
  },
  'zh-CN': {
    addPath: '省略一个属性',
    removePath: '移除属性省略 {index}',
    pathRow: '属性省略 {index}',
    pathArtifact: '工件',
    pathValue: '确切的属性路径（JSON 数组）',
    pathHint: '最多 10 个路径，每个路径最多 16 段。示例：["console", 0, "message"]。字符串用于选择对象键；数字用于遍历数组。无法移除数组元素。路径必须在全局字段省略和文本替换之前匹配。',
    invalidPath: '属性省略 {index} 需要一个有效的字面路径。'
  },
  'zh-TW': {
    addPath: '省略一個屬性',
    removePath: '移除屬性省略 {index}',
    pathRow: '屬性省略 {index}',
    pathArtifact: '擷取項目',
    pathValue: '確切的屬性路徑（JSON 陣列）',
    pathHint: '最多 10 個路徑，每個路徑最多 16 段。範例：["console", 0, "message"]。字串用來選取物件鍵，數字用來走訪陣列。無法移除陣列元素。路徑比對會在全域欄位省略與文字取代之前進行。',
    invalidPath: '屬性省略 {index} 需要有效的常值路徑。'
  },
  'id-ID': {
    addPath: 'Hilangkan satu properti',
    removePath: 'Hapus penghilangan properti {index}',
    pathRow: 'Penghilangan properti {index}',
    pathArtifact: 'Artefak',
    pathValue: 'Jalur properti persis (array JSON)',
    pathHint: 'Hingga 10 jalur, masing-masing dengan 16 segmen. Contoh: ["console", 0, "message"]. String memilih kunci objek; angka menelusuri array. Elemen array tidak dapat dihapus. Jalur harus cocok sebelum penghilangan kolom global dan penggantian teks.',
    invalidPath: 'Penghilangan properti {index} memerlukan jalur literal yang valid.'
  },
  'vi-VN': {
    addPath: 'Bỏ qua một thuộc tính',
    removePath: 'Xóa mục bỏ qua thuộc tính {index}',
    pathRow: 'Mục bỏ qua thuộc tính {index}',
    pathArtifact: 'Tạo phẩm',
    pathValue: 'Đường dẫn thuộc tính chính xác (mảng JSON)',
    pathHint: 'Tối đa 10 đường dẫn, mỗi đường dẫn có tối đa 16 phân đoạn. Ví dụ: ["console", 0, "message"]. Chuỗi chọn khóa của đối tượng; số dùng để duyệt mảng. Không thể xóa phần tử của mảng. Đường dẫn phải khớp trước khi áp dụng việc bỏ qua trường chung và thay thế văn bản.',
    invalidPath: 'Mục bỏ qua thuộc tính {index} cần một đường dẫn dạng chữ hợp lệ.'
  }
}
