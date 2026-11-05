export const hiINHomeReadiness = {
  heading: 'MCP की तैयारी',
  description: 'ब्राउज़र टूल पर भरोसा करने से पहले हर सीमा की अलग-अलग पुष्टि करें।',
  checks: {
    app: 'ऐप्लिकेशन',
    endpoint: 'लोकल एंडपॉइंट',
    initialization: 'क्लाइंट का शुरू होना',
    advertisedTools: 'बताए गए टूल',
    configuration: 'क्लाइंट कॉन्फ़िगरेशन',
    clientVisibility: 'चालू क्लाइंट में दिख रहे टूल',
    probe: 'सिर्फ़ पढ़ने वाली जांच'
  },
  inventory: 'चालू क्लाइंट में दिख रही टूल की सूची चिपकाएं',
  inventoryPlaceholder: 'क्लाइंट का ऐसा आउटपुट चिपकाएं जिसमें browser_* या wallet_* टूल के नाम हों',
  verifyInventory: 'टूल की सूची की तुलना करें',
  copyReport: 'डायग्नोस्टिक कॉपी करें',
  reportLabel: 'कॉपी करने के लिए सुरक्षित MCP तैयारी डायग्नोस्टिक',
  privacy: 'तुलना इसी पेज पर रहती है। कॉपी की गई रिपोर्ट में सिर्फ़ तय स्थितियां, संख्याएं, सीमित टूल नाम और टाइमस्टैंप होते हैं।',
  nextAction: {
    start_honaut: 'लोकल Hronaut लिसनर शुरू करें या ठीक करें।',
    connect_client: 'चालू MCP क्लाइंट को फिर से कनेक्ट करें और उसके शुरू होने का इंतज़ार करें।',
    verify_client_configuration: 'चालू क्लाइंट के कॉन्फ़िगरेशन में इस एंडपॉइंट और ऑथेंटिकेशन की पुष्टि करें।',
    list_tools_in_active_client: 'चालू क्लाइंट में टूल की सूची देखें और यहां उनकी तुलना करें।',
    run_read_only_probe: 'टास्क के अपने वर्कस्पेस में, browser_status या browser_snapshot को एक बार चलाएं।',
    retry_read_only_probe: 'चालू क्लाइंट की गड़बड़ी जांचें, फिर सिर्फ़ पढ़ने वाली एक जांच दोबारा चलाएं।',
    none: 'इस जांच के लिए कोई कार्रवाई ज़रूरी नहीं है।'
  }
}
