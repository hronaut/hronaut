export const hiINNetworkLabels = {
  resourceTypes: {
    document: 'दस्तावेज़',
    stylesheet: 'स्टाइलशीट',
    image: 'इमेज',
    media: 'मीडिया',
    font: 'फ़ॉन्ट',
    script: 'स्क्रिप्ट',
    texttrack: 'टेक्स्ट ट्रैक',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'प्रीफ़ेच',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'मेनिफ़ेस्ट',
    signedexchange: 'साइन किया गया एक्सचेंज',
    ping: 'पिंग',
    cspviolationreport: 'CSP उल्लंघन की रिपोर्ट',
    preflight: 'प्रीफ़्लाइट',
    fedcm: 'FedCM',
    other: 'अन्य'
  },
  responseSources: {
    network: 'नेटवर्क',
    serviceWorker: 'सर्विस वर्कर',
    prefetchCache: 'प्रीफ़ेच कैश',
    diskCache: 'डिस्क कैश',
    otherCache: 'ब्राउज़र कैश'
  },
  workerSources: {
    cacheStorage: 'कैश स्टोरेज',
    httpCache: 'HTTP कैश',
    fallbackCode: 'वर्कर का फ़ॉलबैक कोड',
    network: 'वर्कर के ज़रिए नेटवर्क'
  },
  initiatorTypes: {
    parser: 'पार्सर',
    script: 'स्क्रिप्ट',
    preload: 'प्रीलोड',
    signedexchange: 'साइन किया गया एक्सचेंज',
    preflight: 'प्रीफ़्लाइट',
    fedcm: 'FedCM',
    redirect: 'रीडायरेक्ट',
    other: 'अन्य'
  },
  messageDirections: {
    sent: 'भेजा गया',
    received: 'प्राप्त',
    error: 'गड़बड़ी'
  },
  messageKinds: {
    text: 'टेक्स्ट',
    binary: 'बाइनरी',
    continuation: 'कंटिन्यूएशन',
    close: 'क्लोज़',
    ping: 'पिंग',
    pong: 'पॉन्ग',
    error: 'गड़बड़ी',
    unknown: 'अनजान'
  },
  bodyNotes: {
    binary: 'बाइनरी बॉडी छोड़ दी गई।',
    multipart: 'मल्टीपार्ट बॉडी छोड़ दी गई।',
    unsafeJson: 'JSON बॉडी छोड़ दी गई, क्योंकि इसे सुरक्षित तरीके से छिपाया नहीं जा सका।',
    nonText: 'बिना टेक्स्ट वाली बॉडी छोड़ दी गई।'
  },
  bodyReasons: {
    eventStream: 'सर्वर से भेजे गए इवेंट, सीमित “इवेंट स्ट्रीम” सेक्शन में उपलब्ध हैं।',
    webSocket: 'WebSocket मैसेज, सीमित “मैसेज” सेक्शन में उपलब्ध हैं।',
    expired: 'रिस्पॉन्स बॉडी अब Chromium से उपलब्ध नहीं है।',
    incomplete: 'रिस्पॉन्स बॉडी अभी पूरी नहीं हुई है।',
    devToolsCapture: 'जब इस टैब पर डेवलपर टूल का कंट्रोल था, तब पूरी जानकारी कैप्चर करना उपलब्ध नहीं था।',
    omittedFromExport: 'साफ़ किए गए इस एक्सपोर्ट से रिस्पॉन्स बॉडी छोड़ दी गई।',
    closeDevTools: 'इस टैब के डेवलपर टूल बंद करें, फिर ये जानकारी दोबारा मांगें।',
    evicted: 'Chromium के सीमित डायग्नोस्टिक बफ़र में अब यह रिस्पॉन्स बॉडी नहीं है।'
  },
  searchFields: {
    error: 'अनुरोध की गड़बड़ी',
    message: '{direction} {kind} मैसेज',
    event: '{name} इवेंट'
  }
}
