// Prompt Sweeper Detection Engine v2.6
// Categories: Prompt Residue, AI Slop, Structural Tells, Prompt Injection
// Ported from Chrome extension for Electron (CommonJS)
// v2.3: +15 patterns — marketing superlatives, agency boilerplate, hollow value claims
// v2.4: +18 patterns — creative-writing prompt residue (style mimicry, character beats,
//        iteration artifacts, word-count prompts, rating tags)
// v2.5: +31 patterns — structural slop, list inflation, hedging, RAG/hallucination tells,
//        circular reasoning, shallow explanation, low-information generics
//        (also fixed ? being misflagged as emoji — ? was inside a character class)
// v2.6: +28 patterns — conversational softeners, engagement bait, friendly
//        over-personalization, hype language, rhetorical questions, sycophancy,
//        non-committal wraps, CTA slop

const RULES = [

  // ═══════════════════════════════════════════════════════════════
  // HIGH SEVERITY — Prompt residue / instructions left in text
  // ═══════════════════════════════════════════════════════════════

  { pattern: /\b(please\s+)?(write|create|generate|draft|compose|produce|craft|make)\s+(me\s+)?(a|an|the)\s+\w+/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\b(rewrite|rephrase|revise|paraphrase|summarize|expand|shorten|simplify)\s+(this|the|my|that|it)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\bmake\s+(this|it)\s+(sound|look|read|seem|feel)\s+(more\s+)?\w+/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\b(can you|could you|would you|I need you to|I want you to)\s+\w+/gi, category: 'Prompt Instruction', severity: 'high' },

  { pattern: /\b(act as|pretend you are|you are a|assume the role of|respond as)\s+/gi, category: 'Role Assignment', severity: 'high' },

  { pattern: /\busing\s+(a\s+)?(professional|casual|formal|friendly|persuasive|authoritative)\s+tone\b/gi, category: 'Tone Instruction', severity: 'high' },
  { pattern: /\bin\s+(about\s+)?\d+\s+(words|sentences|paragraphs|bullet points)\b/gi, category: 'Length Instruction', severity: 'high' },
  { pattern: /\bkeep\s+it\s+(under|around|about|to)\s+\d+/gi, category: 'Length Instruction', severity: 'high' },

  { pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)\b/gi, category: 'Prompt Injection', severity: 'high' },
  { pattern: /\bas\s+an?\s+(unrestricted|unfiltered|uncensored|jailbroken)\s+(AI|model|assistant)\b/gi, category: 'Prompt Injection', severity: 'high' },
  { pattern: /\b(DAN|do anything now|developer mode)\b/gi, category: 'Prompt Injection', severity: 'high' },
  { pattern: /\bsystem\s*:\s*/gi, category: 'Prompt Injection', severity: 'high' },
  { pattern: /\b(bypass|override)\s+(safety|content|ethical)\s+(filter|restriction|guideline)s?\b/gi, category: 'Prompt Injection', severity: 'high' },

  // ═══════════════════════════════════════════════════════════════
  // MEDIUM SEVERITY — AI response artifacts & strong AI-isms
  // ═══════════════════════════════════════════════════════════════

  { pattern: /\b(sure|absolutely|of course|certainly|great question)[!,.]?\s*(here['’]?s|let me|I['’]?d be happy|I['’]?ll)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\bhere['’]?s\s+(a|an|the|your)\s+(revised|updated|rewritten|draft|suggested)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\bI['’]?ve\s+(drafted|written|created|prepared|put together|revised|updated)\s+(a|an|the|this|your)\b/gi, category: 'AI Preamble', severity: 'medium' },

  { pattern: /\bas\s+an?\s+(AI|artificial intelligence|language model|large language model|LLM|assistant|chatbot)\b/gi, category: 'AI Self-Reference', severity: 'medium' },
  { pattern: /\bI['’]?m\s+an?\s+(AI|artificial intelligence|language model|assistant)\b/gi, category: 'AI Self-Reference', severity: 'medium' },

  { pattern: /\b(feel free to|don['’]?t hesitate to)\s+(let me know|reach out|ask|modify|adjust|edit|change)/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\blet me know if you['’]?d?\s+(like|want|need)\s+(me to|any|further|more)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bI\s+(hope|trust)\s+this\s+(helps|works|meets|is)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bwould you like me to\s+\w+/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bI\s+can\s+(adjust|modify|revise|tweak|change)\s+(this|it|the|any)\b/gi, category: 'AI Closing', severity: 'medium' },

  { pattern: /\bdelve(s|d)?\s+(into|deeper)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\blet['’]?s\s+(explore|dive|unpack|break down|take a look)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(deep|deeper)\s+dive\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bit['’]?s\s+(important|worth|crucial)\s+to\s+note\s+that\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bin\s+today['’]?s\s+\w+[\s-]*(paced|evolving|changing|driven)?\s*(world|landscape|era|environment|age)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bnavigate\s+the\s+(complexities|challenges|intricacies|nuances|waters)\s+of\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bunlock\s+the\s+(power|potential|full potential|secrets|true potential)\s+of\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(game[\s-]?changer|paradigm\s+shift)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(holistic|comprehensive)\s+(approach|guide|overview|solution|strategy|understanding)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bin\s+the\s+(realm|world|landscape|arena|sphere)\s+of\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\brich\s+tapestry\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bat\s+the\s+end\s+of\s+the\s+day\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bthis\s+underscores\s+the\s+(importance|need|value|significance)\s+of\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(leveraging|tapping\s+into)\s+the\s+(power|potential)\s+of\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bas\s+we\s+(know|navigate|move\s+forward|look\s+ahead)\b/gi, category: 'AI Slop', severity: 'medium' },

  // ═══════════════════════════════════════════════════════════════
  // v2.3 — Marketing superlatives, agency boilerplate, hollow value claims
  // ═══════════════════════════════════════════════════════════════
  { pattern: /\belite\s+(AI|tech|consulting|service|solution|team|engineer|agency)/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bstate[\s-]of[\s-]the[\s-]art\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bnext[\s-](generation|gen)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(industry[\s-]leading|best[\s-]in[\s-]class|world[\s-]class)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(revolutioniz(?:e|es|ed|ing)|revolutionary)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\btransform\s+your\s+(business|team|workflow|organization|company|life|career|future|industry)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bunleash\s+(the\s+)?(power|potential|creativity|innovation|value)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bintelligent\s+(systems?|solutions?|platforms?|automation)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bAI[\s-]driven\s+(workflow|solution|transformation|insight|strategy|innovation|future)s?\b/gi, category: 'AI Slop', severity: 'medium' },

  // Agency boilerplate
  { pattern: /\bwe['’]?re?\s+passionate\s+about\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bwe\s+pride\s+ourselves\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bcommitted\s+to\s+(excellence|delivering|providing|ensuring)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Hollow value claims + jargon
  { pattern: /\b(drive|deliver|maximize|unlock)\s+(value|impact|results|outcomes|growth|success)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\bmission[\s-]critical\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\bturn[\s-]?key\b/gi, category: 'AI Buzzword', severity: 'low' },

  // ═══════════════════════════════════════════════════════════════
  // v2.4 — Creative-writing prompt residue
  // (fiction workflows, style mimicry, iteration artifacts, rating tags)
  // ═══════════════════════════════════════════════════════════════

  // Extended AI preambles
  { pattern: /\bhere['’]?s\s+(a|an|the|your)\s+(enhanced|improved|polished|refined|reworked|rephrased|restructured|tightened)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\bbased\s+on\s+your\s+(request|prompt|input|feedback|instructions?|notes?|preferences?)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\bI['’]?ve\s+(drafted|written|created|prepared|provided|generated|offered|included)\s+(\d+|two|three|four|five|several|multiple|alternative|different)\s+(options?|versions?|alternatives?|endings?|drafts?|variations?)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\bmaking\s+\w+(\s+\w+)?\s+(more|less|even\s+more)\s+(relatable|sympathetic|likeable|mysterious|grounded|believable|human|memorable)\b/gi, category: 'AI Preamble', severity: 'medium' },

  // Conversational artifacts
  { pattern: /\bdo\s+you\s+want\s+me\s+to\s+\w+/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bif\s+you\s+(want|'d\s+like|prefer|like),?\s+I\s+can\s+(also|even\s+)?(create|write|generate|provide|offer|draft|do|make|add|expand|explore)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\blet\s+me\s+know\s+which\s+(one|option|version|ending|draft|variation|direction|approach)\b/gi, category: 'AI Closing', severity: 'medium' },

  // Fiction-workflow prompt residue
  { pattern: /\bmake\s+the\s+tone\s+(more|less|extra)\s+\w+/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\benhance\s+(this|the|my)\s+(scene|passage|section|chapter|dialogue|description|paragraph|draft)\s+to\s+be\s+(more|less)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\balign\s+(more\s+)?with\s+.{1,40}?(style|voice|tone|writing|prose)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\bfocus\s+on\s+\w+(?:['’]s|s')\s+(internal|emotional|mental|character|psychological)\s+(struggle|journey|development|arc|conflict|monologue)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\bensure\s+(the|each|all)\s+characters?\s+(use|have|display|show|feel|sound|avoid|stay)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\bcheck\s+(this|the|my)\s+(scene|passage|chapter|text|story|plot|draft|piece|manuscript)\s+for\s+(logic|inconsistencies|plot\s+holes|errors|issues|problems|gaps|continuity)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\bupdate\s+the\s+(glossary|index|summary|timeline|character\s+list|synopsis|outline|notes?)\s+(based\s+on|for|with|to\s+reflect)\b/gi, category: 'Prompt Instruction', severity: 'high' },

  // Structural writing prompts
  { pattern: /\bwrite\s+a\s+\d{3,}[\s-]?word\s+(chapter|article|post|section|scene|story|essay|piece|blog)\b/gi, category: 'Prompt Instruction', severity: 'high' },
  { pattern: /\btranslate\s+(this|the|my)\s+(text|dialogue|passage|sentence|paragraph|section|line|excerpt)\s+(into|to)\b/gi, category: 'Prompt Instruction', severity: 'high' },

  // Plot-beat scaffolding
  { pattern: /\bwhere\s+(the\s+)?(protagonist|antagonist|hero|villain|main\s+character|narrator)\s+(faces|encounters|discovers|must|struggles|fights|battles|confronts)\b/gi, category: 'Prompt Instruction', severity: 'medium' },

  // Fiction rating tags
  { pattern: /\b(intensity|spice|violence|tension|heat|romance|action|angst)\s+\d+(\s*[,·•|/]\s*(intensity|spice|violence|tension|heat|romance|action|angst)\s+\d+)+\b/gi, category: 'Prompt Instruction', severity: 'high' },

  // ═══════════════════════════════════════════════════════════════
  // v2.5 — Structural slop, list inflation, hedging, RAG/hallucination tells,
  // circular reasoning, shallow explanation, low-information generics
  // ═══════════════════════════════════════════════════════════════

  // Structural openers — "let's [verb]" overuse, listicle headers, article openings
  { pattern: /\blet['’]?s\s+(go\s+(over|deeper|through|into|further)|understand|analyze|examine|simplify|look\s+(at|into)|wrap\s+(it|this)\s+up|conclude|get\s+into\s+it)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bhere\s+(are|is)\s+(the\s+)?(top\s+)?\d+\s+(key\s+)?(reasons?|points?|things?|ways?|steps?|tips?|tricks?|methods?|strategies|takeaways?)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bin\s+this\s+(article|post|guide|piece|essay|chapter|section),?\s+(we\s+)?(will|'ll)\s+(explore|discuss|examine|cover|look\s+at|dive\s+into)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bthis\s+guide\s+will\s+walk\s+you\s+through\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bhere['’]?s\s+everything\s+you\s+need\s+to\s+know\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bbreaking\s+(it|this)\s+down\s+(simply|further|step\s+by\s+step)\b/gi, category: 'AI Slop', severity: 'medium' },

  // List inflation
  { pattern: /\bthere\s+are\s+(many|several|multiple|various|countless|numerous|different|a\s+(number|variety|range)\s+of)\s+(reasons|benefits|advantages|factors|ways|examples|possibilities|approaches|methods|strategies|solutions|techniques|options|considerations|perspectives|aspects)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Filler / hedging extensions
  { pattern: /\b(it\s+should\s+be\s+noted|it\s+is\s+worth\s+mentioning|it\s+bears\s+mentioning|it\s+is\s+worth\s+highlighting)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bin\s+(modern\s+times|many\s+cases|some\s+situations|most\s+cases)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bthere\s+is\s+no\s+one[\s-]size[\s-]fits[\s-]all\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bthis\s+is\s+(a\s+complex|a\s+nuanced|highly\s+nuanced|quite\s+complex|fairly\s+complex)\s+(topic|issue|subject|matter|area)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bthis\s+(plays\s+a\s+key\s+role|cannot\s+be\s+overlooked|is\s+crucial\s+to\s+understand|is\s+essential\s+to\s+consider|is\s+an\s+important\s+consideration)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(broadly|generally|typically|historically)\s+speaking\b/gi, category: 'AI Filler', severity: 'low' },

  // Circular reasoning
  { pattern: /\bthis\s+is\s+(important|valuable|effective|beneficial|useful|relevant|necessary|required|significant)\s+because\s+it\s+(matters|functions|works|is|has|provides|helps|relates|is\s+(needed|mandatory|important))\b/gi, category: 'AI Slop', severity: 'medium' },

  // Authority illusion / variability hedging
  { pattern: /\bdepends\s+on\s+your\s+(needs|goals|situation|use\s+case|environment|setup|approach|preferences|context|specific\s+\w+)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(varies\s+(widely|by\s+context|from\s+case\s+to\s+case)|highly\s+(dependent|context[\s-]dependent)|requires\s+careful\s+consideration|depends\s+on\s+(many|several|multiple|various)\s+factors)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bthere\s+(are\s+(several|multiple)\s+considerations|is\s+no\s+(simple|single|one)\s+answer)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Relevance drift — "zooming out" framing
  { pattern: /\b(zooming\s+out|looking\s+at\s+the\s+bigger\s+picture|stepping\s+back\s+for\s+a\s+moment|expanding\s+beyond\s+this)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Mirror slop / circular how-tos (regex backreference)
  { pattern: /\bto\s+(improve|optimize|enhance|increase|boost|grow|scale)\s+(\w+),?\s+(improve|optimize|enhance|increase|boost|grow|scale|make\s+it\s+more)\s+(?:your\s+|the\s+|that\s+|this\s+|its\s+)?\2\b/gi, category: 'AI Slop', severity: 'medium' },

  // Fake specificity (numeric step claims)
  { pattern: /\b(use|apply|follow|implement)\s+(exactly\s+)?\d+\s+(steps|techniques|methods|principles|rules|strategies|approaches|tactics|tips|tricks|secrets|hacks)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Conclusion / transition artifacts
  { pattern: /\b(to\s+wrap\s+(things|it)\s+up|in\s+summary|to\s+conclude|in\s+the\s+final\s+analysis|all\s+things\s+considered|taking\s+everything\s+into\s+account)\b/gi, category: 'AI Transition', severity: 'low' },
  { pattern: /\bas\s+(we\s+(have\s+(seen|covered|explored|discussed|examined)|discussed|covered|explored|examined|noted|mentioned)|previously\s+(noted|discussed|mentioned)|outlined\s+above|(described|explained)\s+(above|earlier)|mentioned\s+earlier|discussed\s+above)\b/gi, category: 'AI Transition', severity: 'low' },

  // Corporate speak (extends drive/deliver buzzword set)
  { pattern: /\b(enable|facilitate|accelerate|achieve|enhance|leverage)\s+(scalability|transformation|productivity|innovation|capabilities|alignment|performance|growth|outcomes|synergies|workflows?)\b/gi, category: 'AI Buzzword', severity: 'low' },

  // Shallow explanation patterns
  { pattern: /\bthis\s+(improves|enhances|increases|boosts|reduces)\s+(performance|efficiency|speed|results|output|quality|cost|time|accuracy|reliability|stability|usability|flexibility|scalability|effectiveness|consistency|outcomes)\b/gi, category: 'AI Slop', severity: 'low' },

  // RAG / unsourced citation slop
  { pattern: /\b(according\s+to\s+(the\s+)?(sources|provided\s+context)|based\s+on\s+(the\s+)?(retrieved|provided)\s+(data|information|content|context|sources)|the\s+information\s+(suggests|indicates|reveals|shows)|multiple\s+sources\s+(indicate|suggest|show|confirm)|retrieved\s+content\s+shows|context\s+indicates)\b/gi, category: 'AI Slop', severity: 'high' },
  { pattern: /\b(research\s+indicates|studies\s+(suggest|reveal)|evidence\s+(shows|suggests)|reports\s+(indicate|show)|findings\s+(indicate|reveal))\b/gi, category: 'AI Slop', severity: 'low' },

  // Hallucination-adjacent ("widely known" without citation)
  { pattern: /\bthis\s+is\s+(widely|commonly|generally|often|typically|usually)\s+(known|accepted|true|believed|understood|assumed|recognized|acknowledged|agreed|stated|cited|reported|observed|seen|referenced)\b/gi, category: 'AI Slop', severity: 'medium' },

  // Over-sanitized hedging
  { pattern: /\bit\s+(may|might|could)\s+(be\s+(possible|considered|argued|suggested|noted|seen|interpreted)|appear|seem|indicate|suggest|imply|reflect|represent|demonstrate|highlight|depend|differ|vary)\b/gi, category: 'AI Filler', severity: 'low' },

  // Instruction failure — verbose preambles when brevity was requested
  { pattern: /\bhere\s+is\s+(a|an|the)\s+(detailed|comprehensive|long[\s-]form|expanded|full|thorough|in[\s-]depth|complete)\s+(explanation|guide|breakdown|response|overview|version|analysis|deep\s+dive)\b/gi, category: 'AI Preamble', severity: 'medium' },
  { pattern: /\blet['’]?s\s+(go\s+(into|in)\s+detail|dive\s+into\s+detail|explore\s+(deeply|extensively))\b/gi, category: 'AI Slop', severity: 'medium' },

  // Low-information generic phrases
  { pattern: /\b(it|this)\s+(does|involves|affects|changes|impacts|influences|modifies|alters)\s+(things|stuff|something|somehow)\b/gi, category: 'AI Slop', severity: 'low' },

  // ═══════════════════════════════════════════════════════════════
  // v2.6 — Conversational softeners, engagement bait, hype, sycophancy
  // ═══════════════════════════════════════════════════════════════
  { pattern: /^(hey|hi|hello|alright|okay|ok|sure\s+thing|got\s+it|good\s+news|don['’]?t\s+worry|no\s+worries),?[\s—:!]+/gim, category: 'AI Slop', severity: 'medium' },
  { pattern: /\blet['’]?s\s+(clear\s+(this|it)\s+up|make\s+sense\s+of|walk\s+through|get\s+you\s+sorted|keep\s+(things|it)\s+(straightforward|simple)|make\s+(this|it)\s+(super\s+)?(simple|easy))\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bhere['’]?s\s+(the\s+)?(deal|gist|quick\s+(version|answer|breakdown)|simple\s+(version|answer)|short\s+answer)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bif\s+you\s+(want|'d\s+like|prefer|like|need),?\s+you\s+(can|could|may|might)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\byou\s+(might|may|could)\s+(want\s+to|consider|try)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /^(optionally|if\s+(applicable|needed|appropriate|relevant|helpful)),?\s/gim, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(want|need)\s+(me\s+to\s+\w+|a\s+(quick\s+)?(summary|example|breakdown|recap|version)|a\s+(simpler|shorter|longer|more\s+detailed)\s+version)\?/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bhappy\s+to\s+(expand|elaborate|clarify|help|explain|provide|add|share)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bI\s+can\s+(also\s+)?(explain|expand|elaborate|provide|share|show|walk\s+you\s+through|customize|turn\s+this\s+into|break\s+this\s+down|go\s+deeper|make\s+this|give\s+you|add)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\bjust\s+(tell|let)\s+me\s+(know\s+)?if\s+you\s+(want|need|prefer)\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\blet\s+me\s+know\s+if\s+(that|this)\s+(helps|works|is\s+(helpful|useful|enough|clear))\b/gi, category: 'AI Closing', severity: 'medium' },
  { pattern: /\b(I['’]?ve|we['’]?ve)\s+got\s+(you|this)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\byou['’]?re\s+(in\s+the\s+right\s+place|on\s+the\s+right\s+track|asking\s+(the\s+right|smart|great)\s+question|not\s+alone|definitely\s+not\s+the\s+only|doing\s+(great|fine|well)|already\s+ahead|closer\s+than\s+you\s+think|almost\s+there|making\s+progress|thinking\s+(deeply|critically|carefully)|approaching\s+this\s+(well|correctly)|moving\s+in\s+the\s+right\s+direction|getting\s+it|understanding\s+this|picking\s+this\s+up\s+(quickly|fast))\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /^(basically|honestly|literally|obviously|clearly|essentially),?\s/gim, category: 'AI Filler', severity: 'low' },
  { pattern: /\bto\s+be\s+honest,/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bas\s+you\s+(can\s+see|might\s+expect|probably\s+know|may\s+know)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bthis\s+is\s+(huge|massive|incredible|impressive|outstanding|amazing|next[\s-]level|groundbreaking|highly\s+(impactful|optimized|effective)|incredibly\s+(powerful|effective|important|useful)|super\s+(useful|powerful|important)|extremely\s+(important|powerful|effective)|really\s+powerful|very\s+effective)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(why\s+does\s+this\s+matter|so\s+what\s+does\s+this\s+mean|why\s+is\s+this\s+important|what['’]?s\s+(the\s+(takeaway|impact|result|key\s+idea)|going\s+on\s+here)|how\s+(does\s+this\s+work|can\s+you\s+use\s+this)|what\s+(should\s+you\s+(do|know|consider)|happens\s+next|does\s+this\s+(tell|imply|suggest|change|affect|lead\s+to)))\?/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(quick\s+summary|short\s+answer|in\s+short|TL[\s;]*DR|key\s+takeaway|bottom\s+line|main\s+idea|at\s+a\s+glance|in\s+brief|simply\s+put|in\s+simple\s+terms|in\s+a\s+nutshell|here['’]?s\s+the\s+gist|core\s+idea|main\s+point|primary\s+takeaway):/gi, category: 'AI Slop', severity: 'low' },
  { pattern: /\bstep\s+\d+\s*:\s*(understand|analyze|apply|review|improve|consider|implement|start|begin|continue|follow|do)/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(make\s+sure\s+to|don['’]?t\s+forget\s+to|be\s+sure\s+to|always\s+remember\s+to|keep\s+in\s+mind)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bclick\s+here\s+to\s+(continue|proceed|begin|start|learn\s+more)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bdouble[\s-]check\s+your\s+(entries|inputs|details|information)\b/gi, category: 'AI Slop', severity: 'low' },
  { pattern: /\b(to\s+(clarify|elaborate|simplify)|for\s+clarity|to\s+(make\s+(this|it)\s+(clear|easier)|help\s+you\s+understand|provide\s+(insight|context|more\s+detail|clarity)|give\s+context|add\s+clarity|improve\s+understanding|explain\s+further|expand\s+on\s+this|go\s+deeper|break\s+this\s+down))\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\b(that['’]?s\s+(a\s+)?(great|good|excellent|nice|fair|valid|true|fantastic)\s+(point|question|observation|insight|catch)|good\s+(question|observation|catch|point)|excellent\s+question|nice\s+(catch|point)|great\s+insight|well\s+said|totally\s+understandable|that\s+makes\s+sense|you['’]?re\s+absolutely\s+right)\b/gi, category: 'AI Slop', severity: 'medium' },
  { pattern: /\bit['’]?s\s+(situational|context[\s-]dependent|not\s+always\s+clear|hard\s+to\s+say|difficult\s+to\s+determine|not\s+straightforward|not\s+definitive|not\s+(fixed|absolute|guaranteed|certain))\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bit\s+ultimately\s+depends\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(try\s+this\s+today|take\s+action|begin\s+today|don['’]?t\s+wait|act\s+now|give\s+it\s+a\s+try|see\s+for\s+yourself|take\s+the\s+next\s+step|level\s+up|upgrade\s+your\s+approach|boost\s+your\s+results|improve\s+today)\b/gi, category: 'AI Slop', severity: 'medium' },

  { pattern: /\bit['’]?s\s+not\s+(just|only)\s+(about\s+)?\w+[,;]\s*(it['’]?s|but)\s+(about|also)\b/gi, category: 'AI Structure', severity: 'medium' },
  { pattern: /\bthis\s+isn['’]?t\s+just\s+(about\s+)?\w+[,;]\s*(it['’]?s|but)\b/gi, category: 'AI Structure', severity: 'medium' },

  { pattern: /\b(this|these)\s+(shows?|demonstrates?|highlights?|illustrates?|underscores?|proves?)\s+(that|how|the|why)\b/gi, category: 'AI Structure', severity: 'medium' },
  { pattern: /\b(but|so)\s+what\s+(does this|if|can we)\b/gi, category: 'AI Structure', severity: 'medium' },

  // ═══════════════════════════════════════════════════════════════
  // LOW SEVERITY — Flags (not errors, but AI fingerprints)
  // ═══════════════════════════════════════════════════════════════

  { pattern: /\[(?:your|my|client|company|insert|add|recipient)[\w\s]*\]/gi, category: 'Placeholder', severity: 'low' },
  { pattern: /\[(?:NAME|EMAIL|DATE|PHONE|ADDRESS|TITLE|COMPANY|PRODUCT|SERVICE|CITY|STATE|URL|WEBSITE)[\w\s]*\]/gi, category: 'Placeholder', severity: 'low' },
  { pattern: /\{(?:your|my|client|company|insert|add)[\w\s]*\}/gi, category: 'Placeholder', severity: 'low' },
  { pattern: /\bXXX+\b/g, category: 'Placeholder', severity: 'low' },
  { pattern: /\b(Lorem ipsum|dolor sit amet)\b/gi, category: 'Placeholder', severity: 'low' },

  { pattern: /\bthis\s+(section|paragraph|part|email|text|copy|draft)\s+(should|could|needs to|is meant to)\b/gi, category: 'Meta Instruction', severity: 'low' },
  { pattern: /\bTODO\b|\/\/\s*\w|<!--[\s\S]*?-->/g, category: 'Dev Artifact', severity: 'low' },

  { pattern: /\b(leverage|leveraging|leveraged)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(robust|robustly)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(streamline|streamlined|streamlining)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(seamless|seamlessly)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\bcutting[\s-]?edge\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(multifaceted)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(nuanced)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(pivotal)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(palpable)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(intricate|intricately)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(camaraderie)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(ever[\s-]?(evolving|changing|growing|expanding|shifting))\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(foster|fostering|fostered)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(empower|empowering|empowered|empowerment)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(elevate|elevating|elevated)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(harness|harnessing|harnessed)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(synergy|synergies|synergistic)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(impactful)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(resonate|resonates|resonating)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(best\s+practices)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(actionable\s+insights?)\b/gi, category: 'AI Buzzword', severity: 'low' },
  { pattern: /\b(thought\s+leader|thought\s+leadership)\b/gi, category: 'AI Buzzword', severity: 'low' },

  { pattern: /\bwhen\s+it\s+comes\s+to\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\bthe\s+key\s+to\s+\w+\s+is\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(it['’]?s\s+no\s+secret\s+that)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(needless\s+to\s+say)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(it\s+goes\s+without\s+saying)\b/gi, category: 'AI Filler', severity: 'low' },
  { pattern: /\b(do\s+you\s+(know|ever\s+wonder))\b/gi, category: 'AI Filler', severity: 'low' },

  { pattern: /^(Additionally|Furthermore|Moreover|Consequently|Subsequently),/gim, category: 'AI Transition', severity: 'low' },
  { pattern: /\b(that\s+said|that\s+being\s+said|having\s+said\s+that)\b/gi, category: 'AI Transition', severity: 'low' },
  { pattern: /\b(in\s+conclusion|to\s+summarize|to\s+sum\s+up|all\s+in\s+all)\b/gi, category: 'AI Transition', severity: 'low' },
  { pattern: /^(Interestingly|Notably|Importantly|Crucially|Ultimately),/gim, category: 'AI Transition', severity: 'low' },

  { pattern: /\u2014/g, category: 'AI Em Dash', severity: 'low' },

  // ═══════════════════════════════════════════════════════════════
  // EMOJI & ICON TELLS
  // ═══════════════════════════════════════════════════════════════

  { pattern: /[\u2705\u2611\u2714\u2716\u274C\u274E]/g, category: 'AI Emoji Bullet', severity: 'medium' },
  { pattern: /[0-9]\uFE0F?\u20E3/g, category: 'AI Numbered Emoji', severity: 'medium' },
  { pattern: /[\u27A1\u2794\u27A4\u25B8\u25BA\u25B6\u23E9]\uFE0F?/g, category: 'AI Arrow Bullet', severity: 'medium' },

  { pattern: /[\uD83D\uDE80]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83C\uDFAF]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDCA1]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDD25]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\u2B50\uD83C\uDF1F\u2728\u2734\u2733]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDCCA\uD83D\uDCC8\uD83D\uDCC9]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83C\uDFC6\uD83E\uDD47\uD83E\uDD48\uD83E\uDD49]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDCAA\uD83D\uDC4D\uD83D\uDC4F\uD83D\uDE4C]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDC49\uD83D\uDC48]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83C\uDF89\uD83C\uDF8A\u2764]\uFE0F?/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\uD83D\uDCDD\uD83D\uDCCC\uD83D\uDCCB\uD83D\uDCE2\uD83D\uDCE3]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\u26A1\uD83D\uDCA5\uD83D\uDC8E\uD83D\uDD11\uD83D\uDD12\uD83D\uDD13]/gu, category: 'AI Emoji', severity: 'low' },
  { pattern: /[\u26A0\u2757\u2755\u2753\u2754\u203C\u2049]\uFE0F?/gu, category: 'AI Emoji', severity: 'low' },

  { pattern: /[\u2022\u25CF\u25CB\u25AA\u25AB\u25FE\u25FD\u2023\u29BF]/g, category: 'AI Bullet', severity: 'low' },
];

module.exports = { RULES };
