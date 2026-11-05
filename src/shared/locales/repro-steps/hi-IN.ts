export const hiINReproSteps = {
  kinds: {
    navigate: 'नेविगेशन',
    click: 'क्लिक',
    input: 'इनपुट',
    key: 'कुंजी',
    scroll: 'स्क्रोल',
    expect: 'जांच बिंदु'
  },
  steps: {
    open: '{url} खोलें',
    navigate: '{url} पर जाएं',
    navigateWithin: 'पेज के अंदर {url} पर जाएं',
    click: '{target} पर क्लिक करें',
    input: '{target} में टाइप करें (वैल्यू रिकॉर्ड नहीं की गई)',
    key: '{target} पर {key} दबाएं',
    scroll: 'x={x}, y={y} तक स्क्रोल करें',
    expect: 'अनुमानित नतीजा: {condition}',
    captureFailed: 'कार्रवाई का टारगेट कैप्चर नहीं किया जा सका; इस कार्रवाई को मैन्युअल रूप से फिर से बनाएं।',
    captureInterrupted: 'नेविगेशन की वजह से कार्रवाई का कैप्चर बीच में रुक गया; इस कार्रवाई को मैन्युअल रूप से फिर से बनाएं।'
  },
  targets: {
    input: '{type} इनपुट',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'दिख रहा है',
    hidden: 'छिपा है',
    text: 'सटीक टेक्स्ट',
    checked: 'चुना गया',
    unchecked: 'नहीं चुना गया',
    count: 'एलिमेंट की संख्या',
    urlPath: 'URL पाथ'
  }
}
