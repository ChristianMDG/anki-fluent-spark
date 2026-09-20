export interface PronunciationChallenge {
  id: string;
  category: string;
  categoryLabel: string;
  targetWord: string;
  ipa: string;
  confusablePair?: string;
  tip: string;
  /** Optional stress / rhythm note — shown alongside pitch chart for word-stress challenges */
  stressNote?: string;
}

export interface CategoryInfo {
  id: string;
  label: string;
  description: string;
  iconName: string;
}

export const PRONUNCIATION_CATEGORIES: CategoryInfo[] = [
  {
    id: "th_sounds",
    label: "TH Sounds (θ / ð)",
    description: "Master unvoiced θ ('think') and voiced ð ('this') without slipping into S/Z or T/D.",
    iconName: "Volume2",
  },
  {
    id: "vowels",
    label: "Long vs Short Vowels",
    description: "Distinguish tense vs relaxed vowel pairs like 'ship' vs 'sheep' or 'full' vs 'fool'.",
    iconName: "Music",
  },
  {
    id: "english_r",
    label: "English R vs L",
    description: "Curl tongue back without touching the upper palate to avoid French guttural R or L.",
    iconName: "Mic",
  },
  {
    id: "h_sounds",
    label: "Silent & Aspirated H",
    description: "Know when to exhale H softly ('house') and when H is completely silent ('hour').",
    iconName: "Wind",
  },
  {
    id: "w_vs_v",
    label: "W vs V Distinction",
    description: "Round lips into an 'O' for W ('west') vs touching upper teeth to lower lip for V ('vest').",
    iconName: "Smile",
  },
  {
    id: "word_stress",
    label: "Word Stress Placement",
    description: "Learn syllable emphasis shifts (e.g., noun 'REcord' vs verb 'reCORD').",
    iconName: "Activity",
  },
];

export const PRONUNCIATION_CHALLENGES: PronunciationChallenge[] = [
  // 1. TH Sounds
  {
    id: "th-1",
    category: "th_sounds",
    categoryLabel: "TH Sounds (θ / ð)",
    targetWord: "think",
    ipa: "/θɪŋk/",
    confusablePair: "sink",
    tip: "Place your tongue tip gently between your upper and lower teeth and blow air out softly. Don't press tongue against your upper teeth like 'S'.",
  },
  {
    id: "th-2",
    category: "th_sounds",
    categoryLabel: "TH Sounds (θ / ð)",
    targetWord: "this",
    ipa: "/ðɪs/",
    confusablePair: "dis",
    tip: "Keep your tongue tip between your teeth while vibrating your vocal cords. Avoid tapping like a 'D'.",
  },
  {
    id: "th-3",
    category: "th_sounds",
    categoryLabel: "TH Sounds (θ / ð)",
    targetWord: "three",
    ipa: "/θriː/",
    confusablePair: "tree",
    tip: "Start with tongue between teeth for 'TH', then pull back for 'R'. Don't touch the roof of your mouth with your tongue tip.",
  },
  {
    id: "th-4",
    category: "th_sounds",
    categoryLabel: "TH Sounds (θ / ð)",
    targetWord: "thought",
    ipa: "/θɔːt/",
    confusablePair: "taught",
    tip: "Pass continuous air over the tongue tip between teeth. Don't stop the air flow abruptly like a 'T'.",
  },
  {
    id: "th-5",
    category: "th_sounds",
    categoryLabel: "TH Sounds (θ / ð)",
    targetWord: "brother",
    ipa: "/ˈbrʌð.ər/",
    confusablePair: "bruzzer",
    tip: "Voiced TH in the middle — keep tongue tip between teeth, don't let it slip back into a French 'Z'.",
  },

  // 2. Long vs Short Vowels
  {
    id: "vowel-1",
    category: "vowels",
    categoryLabel: "Long vs Short Vowels",
    targetWord: "ship",
    ipa: "/ʃɪp/",
    confusablePair: "sheep",
    tip: "Relax your jaw and tongue for short 'I' (/ɪ/). Don't smile wide or stretch your lips like long 'EE'.",
  },
  {
    id: "vowel-2",
    category: "vowels",
    categoryLabel: "Long vs Short Vowels",
    targetWord: "full",
    ipa: "/fʊl/",
    confusablePair: "fool",
    tip: "Short 'UH' (/ʊ/) as in 'foot' — keep lips slightly rounded and relaxed, not tightly pouted like 'fool'.",
  },
  {
    id: "vowel-3",
    category: "vowels",
    categoryLabel: "Long vs Short Vowels",
    targetWord: "live",
    ipa: "/lɪv/",
    confusablePair: "leave",
    tip: "Keep your tongue low and relaxed for short 'I'. 'Leave' has a tense, higher 'EE' sound.",
  },
  {
    id: "vowel-4",
    category: "vowels",
    categoryLabel: "Long vs Short Vowels",
    targetWord: "hit",
    ipa: "/hɪt/",
    confusablePair: "heat",
    tip: "Short 'I' is quick and relaxed in the center of your mouth; 'heat' is tense with lips pulled back.",
  },
  {
    id: "vowel-5",
    category: "vowels",
    categoryLabel: "Long vs Short Vowels",
    targetWord: "pull",
    ipa: "/pʊl/",
    confusablePair: "pool",
    tip: "Short 'UH' (/ʊ/) is shorter and more relaxed than the tense 'OO' (/uː/) in 'pool'.",
  },

  // 3. English R
  {
    id: "r-1",
    category: "english_r",
    categoryLabel: "English R vs L",
    targetWord: "right",
    ipa: "/raɪt/",
    confusablePair: "light",
    tip: "Curl your tongue back without touching the roof of your mouth. For 'L', the tongue tip touches behind upper teeth.",
  },
  {
    id: "r-2",
    category: "english_r",
    categoryLabel: "English R vs L",
    targetWord: "rice",
    ipa: "/raɪs/",
    confusablePair: "lice",
    tip: "Pull your tongue back into the middle of your mouth. Do NOT touch your front teeth or upper gum.",
  },
  {
    id: "r-3",
    category: "english_r",
    categoryLabel: "English R vs L",
    targetWord: "read",
    ipa: "/riːd/",
    confusablePair: "lead",
    tip: "Round your lips slightly and pull tongue back. Avoid resting your tongue against the upper gum ridge.",
  },
  {
    id: "r-4",
    category: "english_r",
    categoryLabel: "English R vs L",
    targetWord: "rock",
    ipa: "/rɒk/",
    confusablePair: "lock",
    tip: "Keep the tongue tip suspended mid-mouth for 'R'. Don't flick your tongue against upper front teeth.",
  },

  // 4. Silent / Aspirated H
  {
    id: "h-1",
    category: "h_sounds",
    categoryLabel: "Silent & Aspirated H",
    targetWord: "hour",
    ipa: "/ˈaʊ.ər/",
    confusablePair: "our",
    tip: "The 'H' in 'hour' is SILENT. Start directly with the vowel sound 'OW'.",
  },
  {
    id: "h-2",
    category: "h_sounds",
    categoryLabel: "Silent & Aspirated H",
    targetWord: "house",
    ipa: "/haʊs/",
    confusablePair: "ouse",
    tip: "Exhale a soft puff of air at the start for aspirated 'H'. Don't drop the 'H'!",
  },
  {
    id: "h-3",
    category: "h_sounds",
    categoryLabel: "Silent & Aspirated H",
    targetWord: "honest",
    ipa: "/ˈɒn.ɪst/",
    confusablePair: "onest",
    tip: "Silent 'H' — start immediately with 'ON' sound.",
  },
  {
    id: "h-4",
    category: "h_sounds",
    categoryLabel: "Silent & Aspirated H",
    targetWord: "happy",
    ipa: "/ˈhæp.i/",
    confusablePair: "appy",
    tip: "Breathe out air gently from the throat before the vowel. Don't omit the 'H'!",
  },
  {
    id: "h-5",
    category: "h_sounds",
    categoryLabel: "Silent & Aspirated H",
    targetWord: "honor",
    ipa: "/ˈɒn.ər/",
    confusablePair: "onor",
    tip: "Silent 'H' — start immediately with 'ON'.",
  },

  // 5. W vs V
  {
    id: "wv-1",
    category: "w_vs_v",
    categoryLabel: "W vs V Distinction",
    targetWord: "west",
    ipa: "/west/",
    confusablePair: "vest",
    tip: "Round your lips into a small 'O' for 'W'. For 'V', touch your upper teeth to your lower lip.",
  },
  {
    id: "wv-2",
    category: "w_vs_v",
    categoryLabel: "W vs V Distinction",
    targetWord: "wine",
    ipa: "/waɪn/",
    confusablePair: "vine",
    tip: "Pucker lips like a kiss for 'W'. Do NOT let upper teeth touch lower lip.",
  },
  {
    id: "wv-3",
    category: "w_vs_v",
    categoryLabel: "W vs V Distinction",
    targetWord: "wet",
    ipa: "/wet/",
    confusablePair: "vet",
    tip: "Glide from rounded lips for 'W'. 'V' requires friction between upper teeth and bottom lip.",
  },
  {
    id: "wv-4",
    category: "w_vs_v",
    categoryLabel: "W vs V Distinction",
    targetWord: "wood",
    ipa: "/wʊd/",
    confusablePair: "vood",
    tip: "Lips form a tight 'O' for 'W'. No tooth-on-lip contact!",
  },

  // 6. Word Stress Placement
  {
    id: "stress-1",
    category: "word_stress",
    categoryLabel: "Word Stress Placement",
    targetWord: "record",
    ipa: "/ˈrek.ɔːd/",
    confusablePair: "reCORD",
    tip: "As a noun ('a record'), stress the FIRST syllable ('RE-cord'). As a verb, stress the SECOND syllable ('re-CORD').",
  },
  {
    id: "stress-2",
    category: "word_stress",
    categoryLabel: "Word Stress Placement",
    targetWord: "photograph",
    ipa: "/ˈfəʊ.tə.ɡrɑːf/",
    confusablePair: "photography",
    tip: "Stress the 1st syllable in 'PHO-tograph', but the 2nd syllable in 'pho-TOG-raphy'.",
  },
  {
    id: "stress-3",
    category: "word_stress",
    categoryLabel: "Word Stress Placement",
    targetWord: "present",
    ipa: "/ˈprez.ənt/",
    confusablePair: "preSENT",
    tip: "Stress the first syllable for the gift/noun ('PRE-sent'); stress second for the action ('pre-SENT').",
  },
  {
    id: "stress-4",
    category: "word_stress",
    categoryLabel: "Word Stress Placement",
    targetWord: "object",
    ipa: "/ˈɒb.dʒɪkt/",
    confusablePair: "obJECT",
    tip: "First syllable emphasis for the noun ('OB-ject'); second syllable for the verb ('ob-JECT').",
  },
  {
    id: "stress-5",
    category: "word_stress",
    categoryLabel: "Word Stress Placement",
    targetWord: "import",
    ipa: "/ˈɪm.pɔːt/",
    confusablePair: "imPORT",
    tip: "First syllable for the noun ('IM-port'); second syllable for the action ('im-PORT').",
  },
];

export function getChallengesForCategory(categoryId: string, count: number): PronunciationChallenge[] {
  let list: PronunciationChallenge[];
  if (categoryId === "mixed") {
    list = [...PRONUNCIATION_CHALLENGES].sort(() => Math.random() - 0.5);
  } else {
    list = PRONUNCIATION_CHALLENGES.filter((c) => c.category === categoryId);
  }
  return list.slice(0, count);
}
