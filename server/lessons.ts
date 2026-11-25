import type { LessonItem } from '../shared/types.ts';

export const LESSONS_CATALOG: LessonItem[] = [
  {
    id: 'smartphone-basics',
    category: 'phone',
    durationMinutes: 4,
    title: {
      en: 'Smartphone Basics & Volume',
      hi: 'स्मार्टफोन की बुनियादी बातें और आवाज़',
      mr: 'स्मार्टफोनची मूलभूत माहिती आणि आवाज',
      hinglish: 'Smartphone Basics aur Volume Set Karna',
    },
    summary: {
      en: 'Learn how to unlock your screen, adjust volume, and brighten the display comfortably.',
      hi: 'स्क्रीन अनलॉक करना, आवाज़ बढ़ाना और स्क्रीन की रोशनी ठीक करना सीखें।',
      mr: 'स्क्रीन अनलॉक करणे, आवाज वाढवणे आणि स्क्रीनचा प्रकाश योग्य ठेवणे शिका.',
      hinglish: 'Screen unlock karna, volume badhana aur brightness set karna seekhein.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'Wake & Unlock Safely', instruction: 'Press the side power button once to light up the screen, then swipe up gently or enter your PIN.', tip: 'Never share your phone PIN with strangers.' },
        { stepNumber: 2, title: 'Increase Call & Media Volume', instruction: 'Press the upper button on the side of your phone while talking or listening to make the sound louder.', tip: 'Tap the speaker icon during a call if you want hands-free sound.' },
        { stepNumber: 3, title: 'Adjust Screen Brightness', instruction: 'Swipe down from the very top edge of your screen and slide the sun bar to the right for clearer reading.', tip: 'Brighter text helps outdoors; softer light feels calm at night.' },
      ],
      hi: [
        { stepNumber: 1, title: 'स्क्रीन खोलें', instruction: 'फ़ोन के किनारे का पावर बटन एक बार दबाएँ और स्क्रीन ऊपर स्वाइप करके अपना पिन डालें।', tip: 'अपना फ़ोन पिन किसी अनजान व्यक्ति को न बताएँ।' },
        { stepNumber: 2, title: 'आवाज़ बढ़ाएँ', instruction: 'बात करते समय फ़ोन के किनारे ऊपर वाला बटन दबाकर आवाज़ तेज़ करें।', tip: 'फ़ोन दूर रखकर सुनने के लिए स्पीकर आइकन दबाएँ।' },
        { stepNumber: 3, title: 'रोशनी ठीक करें', instruction: 'स्क्रीन के ऊपर से नीचे स्वाइप करें और सूरज वाले स्लाइडर को दाएँ खिसकाएँ।', tip: 'साफ़ पढ़ने के लिए रोशनी आरामदायक रखें।' },
      ],
      mr: [
        { stepNumber: 1, title: 'स्क्रीन उघडा', instruction: 'फोनच्या बाजूचे पॉवर बटण एकदा दाबा, वर स्वाइप करा आणि तुमचा पिन टाका.', tip: 'अनोळखी व्यक्तीला पिन सांगू नका.' },
        { stepNumber: 2, title: 'आवाज वाढवा', instruction: 'बोलताना किंवा ऐकताना बाजूचे वरचे बटण दाबून आवाज मोठा करा.', tip: 'हँड्स-फ्री ऐकण्यासाठी स्पीकर चिन्हावर टॅप करा.' },
        { stepNumber: 3, title: 'स्क्रीन प्रकाश वाढवा', instruction: 'स्क्रीनच्या वरून खाली स्वाइप करा आणि सूर्याचे चिन्ह उजवीकडे सरकवा.', tip: 'स्पष्ट वाचण्यासाठी योग्य प्रकाश ठेवा.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Screen Unlock Karein', instruction: 'Side ka power button ek baar dabayein, upar swipe karein aur apna PIN daalein.', tip: 'Apna phone PIN kisi anjaan ko mat batayein.' },
        { stepNumber: 2, title: 'Volume Badhayein', instruction: 'Call ya video ke waqt side ka upar wala button dabakar awaaz tez karein.', tip: 'Speaker icon dabakar aap hands-free sun sakte hain.' },
        { stepNumber: 3, title: 'Brightness Set Karein', instruction: 'Screen ke upar se neeche swipe karein aur sun slider ko right le jayein.', tip: 'Dhoop mein zyada aur raat mein halka brightness rakhein.' },
      ],
    },
  },
  {
    id: 'whatsapp-photos',
    category: 'communication',
    durationMinutes: 5,
    title: {
      en: 'WhatsApp Messages & Sending Photos',
      hi: 'व्हाट्सएप संदेश और फोटो भेजना',
      mr: 'व्हॉट्सअॅप मेसेज आणि फोटो पाठवणे',
      hinglish: 'WhatsApp Message aur Photo Bhejna',
    },
    summary: {
      en: 'Send messages, voice notes, and family photos step by step on WhatsApp.',
      hi: 'व्हाट्सएप पर संदेश, आवाज़ संदेश और परिवार की तस्वीरें भेजना सीखें।',
      mr: 'व्हॉट्सअॅपवर संदेश, व्हॉइस नोट्स आणि कुटुंबाचे फोटो पाठवायला शिका.',
      hinglish: 'WhatsApp par message, voice note aur family photos bhejna seekhein.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'Open Family Chat', instruction: 'Tap the green WhatsApp icon, then tap the name of the family member you want to message.', tip: 'Check the profile photo and name at the top before sending.' },
        { stepNumber: 2, title: 'Attach a Photo', instruction: 'Tap the paperclip or camera icon next to the typing box, choose Gallery/Photos, pick your picture, and tap the green Send arrow.', tip: 'You can add a short caption before tapping Send.' },
        { stepNumber: 3, title: 'Send a Voice Note', instruction: 'Press and hold the green microphone icon while speaking, then lift your finger to send.', tip: 'If you prefer typing, tap the message box to open the keyboard.' },
      ],
      hi: [
        { stepNumber: 1, title: 'चैट खोलें', instruction: 'हरे व्हाट्सएप आइकन को दबाएँ और परिवार के सदस्य का नाम चुनें।', tip: 'भेजने से पहले ऊपर नाम ज़रूर देख लें।' },
        { stepNumber: 2, title: 'फोटो चुनें और भेजें', instruction: 'टाइप करने वाले बॉक्स के पास कैमरा या क्लिप आइकन दबाएँ, फोटो चुनें और हरा तीर दबाएँ।', tip: 'फोटो के साथ छोटा संदेश भी लिख सकते हैं।' },
        { stepNumber: 3, title: 'आवाज़ संदेश भेजें', instruction: 'हरे माइक बटन को दबाकर रखें, बोलें और भेजने के लिए उंगली हटा लें।', tip: 'बोलते समय फ़ोन पास रखें।' },
      ],
      mr: [
        { stepNumber: 1, title: 'चॅट उघडा', instruction: 'हिरवे व्हॉट्सअॅप चिन्ह दाबा आणि कुटुंबातील व्यक्तीचे नाव निवडा.', tip: 'संदेश पाठवण्यापूर्वी वर नाव तपासा.' },
        { stepNumber: 2, title: 'फोटो पाठवा', instruction: 'बॉक्सजवळील कॅमेरा किंवा क्लिप चिन्ह दाबा, गॅलरीतून फोटो निवडा आणि हिरवा बाण दाबा.', tip: 'फोटोखाली लहान ओळ लिहू शकता.' },
        { stepNumber: 3, title: 'व्हॉइस मेसेज पाठवा', instruction: 'हिरवा माइक दाबून धरा, बोला आणि पाठवण्यासाठी बोट सोडा.', tip: 'बोलताना फोन जवळ धरा.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Chat Open Karein', instruction: 'Green WhatsApp icon tap karein aur family member ka naam chunein.', tip: 'Bhejne se pehle upar naam zaroor check karein.' },
        { stepNumber: 2, title: 'Photo Select Karke Send Karein', instruction: 'Message box ke paas camera ya clip icon dabayein, photo select karein aur green send arrow dabayein.', tip: 'Send se pehle chota caption likh sakte hain.' },
        { stepNumber: 3, title: 'Voice Note Bhejein', instruction: 'Green mic button dabakar rakhein, bolein aur send karne ke liye ungli chhod dein.', tip: 'Saaf awaaz ke liye phone paas rakhein.' },
      ],
    },
  },
  {
    id: 'video-calls',
    category: 'communication',
    durationMinutes: 4,
    title: {
      en: 'Making Clear Video Calls',
      hi: 'साफ़ वीडियो कॉल करना',
      mr: 'स्पष्ट व्हिडिओ कॉल करणे',
      hinglish: 'Clear Video Call Kaise Karein',
    },
    summary: {
      en: 'Start a video call, keep your face well-lit, and switch camera or speaker easily.',
      hi: 'वीडियो कॉल शुरू करना, रोशनी में बैठना और आवाज़-कैमरा नियंत्रित करना सीखें।',
      mr: 'व्हिडिओ कॉल सुरू करणे, चांगला प्रकाश ठेवणे आणि कॅमेरा वापरणे शिका.',
      hinglish: 'Video call start karna, achi lighting rakhna aur camera switch karna seekhein.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'Start the Video Call', instruction: 'Open your family member chat in WhatsApp and tap the Video Camera icon at the top right.', tip: 'Sit facing a window or lamp so family can see you clearly.' },
        { stepNumber: 2, title: 'Mute or End Safely', instruction: 'Tap the red phone button when you finish talking. Tap the microphone icon only if you want to mute your voice briefly.', tip: 'Keep the phone resting on a table so your arm does not get tired.' },
      ],
      hi: [
        { stepNumber: 1, title: 'वीडियो कॉल शुरू करें', instruction: 'व्हाट्सएप चैट खोलकर ऊपर दाईं ओर वीडियो कैमरा आइकन दबाएँ।', tip: 'चेहरे पर रोशनी रहे इसके लिए खिड़की या लाइट के सामने बैठें।' },
        { stepNumber: 2, title: 'कॉल समाप्त करें', instruction: 'बात पूरी होने पर लाल फ़ोन बटन दबाएँ।', tip: 'हाथ थकने से बचाने के लिए फ़ोन को मेज़ पर टिकाकर रखें।' },
      ],
      mr: [
        { stepNumber: 1, title: 'व्हिडिओ कॉल सुरू करा', instruction: 'व्हॉट्सअॅप चॅटमध्ये वर उजवीकडे असलेले व्हिडिओ कॅमेरा चिन्ह दाबा.', tip: 'चेहरा स्पष्ट दिसण्यासाठी प्रकाशासमोर बसा.' },
        { stepNumber: 2, title: 'कॉल बंद करा', instruction: 'बोलून झाल्यावर लाल फोन बटण दाबा.', tip: 'हात दुखू नये म्हणून फोन टेबलावर टेकवून ठेवा.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Video Call Start Karein', instruction: 'WhatsApp chat kholein aur upar right side mein video camera icon tap karein.', tip: 'Light ke saamne baithein taaki chehra saaf dikhe.' },
        { stepNumber: 2, title: 'Call End Karein', instruction: 'Baat khatam hone par red phone button dabayein.', tip: 'Phone table par tikakar rakhein taaki haath na thake.' },
      ],
    },
  },
  {
    id: 'otp-upi-safety',
    category: 'safety',
    durationMinutes: 5,
    title: {
      en: 'OTP, UPI & Bank Safety',
      hi: 'ओटीपी, यूपीआई और बैंक सुरक्षा',
      mr: 'ओटीपी, यूपीआय आणि बँक सुरक्षा',
      hinglish: 'OTP, UPI aur Bank Safety Rules',
    },
    summary: {
      en: 'Golden rules to protect your bank account, OTPs, QR codes, and UPI PIN.',
      hi: 'अपने बैंक खाते, ओटीपी, क्यूआर कोड और यूपीआई पिन को सुरक्षित रखने के सुनहरे नियम।',
      mr: 'तुमचे बँक खाते, ओटीपी, क्यूआर कोड आणि यूपीआय पिन सुरक्षित ठेवण्याचे नियम.',
      hinglish: 'Apna bank account, OTP, QR code aur UPI PIN safe rakhne ke golden rules.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'You Never Need a PIN to Receive Money', instruction: 'To receive money in UPI, you do nothing—never enter your UPI PIN or scan a QR code to receive funds.', tip: 'A UPI PIN is ONLY for paying money out of your account.' },
        { stepNumber: 2, title: 'Keep Every OTP Secret', instruction: 'Banks, police, electricity boards, and government offices NEVER call asking for your OTP or PIN.', tip: 'If anyone pressures you urgently, hang up and check with family.' },
        { stepNumber: 3, title: 'Never Install Screen-Share Apps for Callers', instruction: 'Refuse requests to download AnyDesk, TeamViewer, or QuickSupport from unknown callers.', tip: 'Use Buddy Elder AI’s "Is This Safe?" checker whenever unsure.' },
      ],
      hi: [
        { stepNumber: 1, title: 'पैसे पाने के लिए पिन नहीं लगता', instruction: 'खाते में पैसे आने के लिए कभी यूपीआई पिन नहीं डालना पड़ता और न ही क्यूआर कोड स्कैन करना होता है।', tip: 'पिन केवल पैसे भेजने के लिए होता है।' },
        { stepNumber: 2, title: 'ओटीपी हमेशा गुप्त रखें', instruction: 'बैंक, पुलिस या कोई भी सरकारी विभाग फ़ोन पर ओटीपी नहीं माँगता।', tip: 'कोई जल्दीबाज़ी करे तो तुरंत कॉल काट दें।' },
        { stepNumber: 3, title: 'स्क्रीन-शेयरिंग ऐप न डालें', instruction: 'किसी अनजान कॉलर के कहने पर AnyDesk या TeamViewer जैसे ऐप कभी डाउनलोड न करें।', tip: 'शक होने पर "Is This Safe?" में जाँचें।' },
      ],
      mr: [
        { stepNumber: 1, title: 'पैसे मिळण्यासाठी पिन लागत नाही', instruction: 'पैसे स्वीकारण्यासाठी कधीही यूपीआय पिन टाकू नका किंवा क्यूआर कोड स्कॅन करू नका.', tip: 'पिन फक्त पैसे पाठवण्यासाठी असतो.' },
        { stepNumber: 2, title: 'ओटीपी कोणालाही सांगू नका', instruction: 'बँक, पोलीस किंवा सरकारी अधिकारी फोनवर ओटीपी किंवा पिन मागत नाहीत.', tip: 'घाई करणाऱ्या कॉलरचा फोन लगेच कट करा.' },
        { stepNumber: 3, title: 'रिमोट अॅप डाउनलोड करू नका', instruction: 'अनोळखी व्यक्तीच्या सांगण्यावरून AnyDesk किंवा TeamViewer डाउनलोड करू नका.', tip: 'शंका असल्यास "Is This Safe?" वापरा.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Paise Lene Ke Liye PIN Nahi Lagta', instruction: 'Account mein paise receive karne ke liye kabhi UPI PIN na daalein aur na QR scan karein.', tip: 'UPI PIN sirf paise bhejne ke liye hota hai.' },
        { stepNumber: 2, title: 'OTP Hamesha Secret Rakhein', instruction: 'Bank, police ya government call par kabhi OTP ya PIN nahi maangte.', tip: 'Koi jaldi kare toh turant call cut kar dein.' },
        { stepNumber: 3, title: 'Screen-Share Apps Install Na Karein', instruction: 'Anjaan caller ke kehne par AnyDesk ya TeamViewer kabhi install na karein.', tip: 'Doubt ho toh Buddy ke "Is This Safe?" mein check karein.' },
      ],
    },
  },
  {
    id: 'google-maps-travel',
    category: 'daily_tools',
    durationMinutes: 4,
    title: {
      en: 'Using Google Maps & Finding Places',
      hi: 'गूगल मैप्स से रास्ता देखना',
      mr: 'गूगल मॅप्सने रस्ता शोधणे',
      hinglish: 'Google Maps Se Rasta Aur Jagah Dhundhna',
    },
    summary: {
      en: 'Search for clinics, pharmacies, or family homes and share your live location safely.',
      hi: 'अस्पताल, दवा की दुकान या घर का रास्ता खोजना और परिवार को लोकेशन भेजना सीखें।',
      mr: 'दवाखाना, औषधांचे दुकान किंवा घराचा रस्ता शोधायला शिका.',
      hinglish: 'Clinic, medical store ya ghar ka rasta dhundhna aur location share karna seekhein.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'Search by Voice or Text', instruction: 'Open Google Maps, tap the microphone icon in the top search bar, and say the place name clearly.', tip: 'Tap "Directions" to see travel time and route.' },
        { stepNumber: 2, title: 'Share Location Only With Trusted Family', instruction: 'Tap the blue dot showing where you are, then tap "Share location" and pick only a trusted family member.', tip: 'Set a time limit like 1 hour when sharing.' },
      ],
      hi: [
        { stepNumber: 1, title: 'बोलकर जगह खोजें', instruction: 'गूगल मैप्स खोलें, ऊपर माइक आइकन दबाएँ और जगह का नाम साफ़ बोलें।', tip: 'रास्ता देखने के लिए Directions दबाएँ।' },
        { stepNumber: 2, title: 'सिर्फ परिवार से लोकेशन साझा करें', instruction: 'नीले बिंदु पर टैप करके केवल अपने विश्वसनीय परिवारजन को लोकेशन भेजें।', tip: 'समय सीमा चुनना सुरक्षित रहता है।' },
      ],
      mr: [
        { stepNumber: 1, title: 'बोलून ठिकाण शोधा', instruction: 'गूगल मॅप्स उघडा, वरच्या माइक चिन्हावर टॅप करून ठिकाणाचे नाव बोला.', tip: 'रस्ता पाहण्यासाठी Directions दाबा.' },
        { stepNumber: 2, title: 'फक्त कुटुंबाशी लोकेशन शेअर करा', instruction: 'निळ्या ठिपक्यावर टॅप करून फक्त विश्वासू कुटुंबीयांना लोकेशन पाठवा.', tip: 'वेळेची मर्यादा निवडणे सुरक्षित असते.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Bolkar Jagah Search Karein', instruction: 'Google Maps kholein, upar mic icon tap karein aur jagah ka naam bolein.', tip: 'Rasta dekhne ke liye Directions tap karein.' },
        { stepNumber: 2, title: 'Sirf Family Ko Location Bhejein', instruction: 'Blue dot par tap karke sirf bharosemand family member ko location share karein.', tip: '1 hour jaisa time limit set karna safe hai.' },
      ],
    },
  },
  {
    id: 'scam-awareness',
    category: 'safety',
    durationMinutes: 5,
    title: {
      en: 'Spotting Fake Calls, Links & Offers',
      hi: 'नकली कॉल, लिंक और ऑफ़र पहचानना',
      mr: 'बनावट कॉल, लिंक आणि ऑफर्स ओळखणे',
      hinglish: 'Fake Calls, Links aur Offers Kaise Pehchanein',
    },
    summary: {
      en: 'Recognize urgency tricks, lottery scams, fake courier SMS, and impersonation calls.',
      hi: 'जल्दीबाज़ी का दबाव, लॉटरी संदेश, नकली कूरियर लिंक और ठगी के तरीकों को पहचानें।',
      mr: 'घाईचे दडपण, लॉटरी संदेश आणि बनावट कूरियर लिंक ओळखायला शिका.',
      hinglish: 'Urgency tricks, lottery messages aur fake courier SMS ko pehchanna seekhein.',
    },
    steps: {
      en: [
        { stepNumber: 1, title: 'Pause When Someone Rushes You', instruction: 'Scammers create fear or excitement ("Act in 10 minutes or account closes!"). Always pause for 30 seconds.', tip: 'Real banks and officials give you time to verify in person.' },
        { stepNumber: 2, title: 'Check Web Addresses Carefully', instruction: 'Avoid tapping unfamiliar links like bit.ly or strange spellings. Open the official app yourself instead.', tip: 'Paste any suspicious text into Buddy’s "Is This Safe?" tool.' },
      ],
      hi: [
        { stepNumber: 1, title: 'जल्दीबाज़ी में रुकें और सोचें', instruction: 'ठग डर या लालच दिखाते हैं। कोई भी कदम उठाने से पहले 30 सेकंड रुकें।', tip: 'असली बैंक कभी 10 मिनट में खाता बंद करने की धमकी नहीं देते।' },
        { stepNumber: 2, title: 'लिंक पर सीधे क्लिक न करें', instruction: 'अजीब या छोटे लिंक खोलने के बजाय हमेशा आधिकारिक ऐप या वेबसाइट खुद खोलें।', tip: 'संदिग्ध संदेश को "Is This Safe?" में जाँचें।' },
      ],
      mr: [
        { stepNumber: 1, title: 'घाईत निर्णय घेऊ नका', instruction: 'फसवणूक करणारे भीती किंवा आमिष दाखवतात. कोणताही निर्णय घेण्यापूर्वी ३० सेकंद थांबा.', tip: 'खरी बँक कधीही तात्काळ खाते बंद करण्याची धमकी देत नाही.' },
        { stepNumber: 2, title: 'अनोळखी लिंकवर क्लिक करू नका', instruction: 'लिंकवर टॅप करण्याऐवजी नेहमी अधिकृत अॅप स्वतः उघडा.', tip: 'संशयास्पद संदेश "Is This Safe?" मध्ये तपासा.' },
      ],
      hinglish: [
        { stepNumber: 1, title: 'Jaldi Mein Faisla Na Lein', instruction: 'Scammers darr ya lalach dikhate hain. Koi bhi step lene se pehle 30 second rukein.', tip: 'Asli bank kabhi 10 minute mein account band karne ki dhamki nahi dete.' },
        { stepNumber: 2, title: 'Unknown Link Click Na Karein', instruction: 'Ajib links click karne ke bajay official app khud kholein.', tip: 'Shaq ho toh "Is This Safe?" mein paste karke check karein.' },
      ],
    },
  },
];
