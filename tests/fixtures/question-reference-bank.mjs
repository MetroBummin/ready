import { DEFAULT_PASSAGE, DESIGN_PASSAGE, INTRO_PASSAGE } from './question-authoring-ref-3-10.mjs';

export const REFERENCE_BANK_ID='cheonjae-kang-l2-exam4you-r1-r4';
export const TARGET_PASSAGE_ID='741d6581-1f4c-4e1d-823c-6be85c62bf52';

export const PEER_PRESSURE_PASSAGE=`If you are told what other people do, you might do it too, because you think it is probably a good idea to do what they do. And even if you aren’t sure, you might not want to disobey social norms, so you will go along. Highlighting the right decisions of others can lead one to do the right thing. While the sign saying “Take your trash home or get a $100 fine.” pushes people, the one saying “Take your trash home. Other people do.” nudges them. Many people feel compelled to match their behavior with that of the majority. The decision is theirs, but they have been nudged. However, nudging people into making good choices does not always go as planned. For instance, in a study of household energy conservation, the researchers provided the residents with information about their neighbors’ average energy use. As expected, those who had consumed more energy than the average reduced their use later; however, households with low levels of energy consumption increased their use after learning that their consumption had been lower than their neighbors’. The researchers inferred that the lack of a reminder about the environmental benefits of saving energy could have caused the information to have an opposite effect. Later, they added a smiley face to the information sent to those who used less energy than the average, and found that it neutralized the opposite effect.`;

export const DEFAULT_CLOSING_PASSAGE=`Nudging through defaults can also apply to a food delivery app. A company recently announced an update for its app where it would change the default settings for the optional items, such as forks, spoons, and straws. Users would have to opt out of the default to get them. The company mentioned in an online post that having surveyed many of its customers, they found that more than 90% of them didn’t really need disposable plastic items with their orders. Are you interested in changing certain people’s behavior? Then why not nudge them in the right direction? There are many ways to subtly influence people to make better decisions. As we are all choice architects every now and then, it pays to know how to set people on the right path.`;

export const DEFAULT_FULL_PASSAGE=`${DEFAULT_PASSAGE} ${DEFAULT_CLOSING_PASSAGE}`;
export const BANK_CANONICAL_PASSAGE=[INTRO_PASSAGE,'Through Designs',DESIGN_PASSAGE,'Through Peer Pressure',PEER_PRESSURE_PASSAGE,'Through Defaults',DEFAULT_FULL_PASSAGE].join(' ');

export const REFERENCE_FILES=Object.freeze([
  {round:1,sha256:'e3bb6bd922912a9a8d40654080e0fb6c6ca7beb312af819c73657c289499b5ac',questionCount:20},
  {round:2,sha256:'36ce483bd3ca56ef0d4556bff4475b93e164dd6e8ea8fbacf3df7c4a13303905',questionCount:20},
  {round:3,sha256:'58f7b5a6e07e52949277a9f338e9491022eed8d01d1dd2b0f740a10c5db4a7a9',questionCount:20},
  {round:4,sha256:'11c218288a8747b6fd6c7bee6347ca68da9eb381346c2500840bc441e66a12c0',questionCount:20},
]);

const style=(round,questionNo,sourcePassage,questionType)=>({id:`r${round}-q${questionNo}`,round,questionNo,sourcePassage,overlap:'none',contentReference:false,questionType,answerVerified:true,explanationAvailable:true});
const content=(round,questionNo,sourcePassage,questionType)=>({id:`r${round}-q${questionNo}`,round,questionNo,sourcePassage,overlap:'exact_or_mutation_round_trip',contentReference:true,questionType,answerVerified:true,explanationAvailable:true});

const R1=[
  style(1,1,'dialogue_trash_can','content_multi'),style(1,2,'dialogue_soap','paraphrase_multi'),
  content(1,3,'intro','paragraph_order'),content(1,4,'intro','grammar_multi'),content(1,5,'intro','unanswerable'),content(1,6,'defaults','summary'),
  content(1,7,'designs','grammar_ab'),content(1,8,'designs','constrained_writing'),content(1,9,'designs','blank_phrase'),content(1,10,'designs','main_idea'),
  content(1,11,'peer_pressure','reference'),content(1,12,'peer_pressure','connectors'),content(1,13,'peer_pressure','grammar_correction'),content(1,14,'peer_pressure','content_false'),
  content(1,15,'defaults','vocabulary_context'),content(1,16,'defaults','topic'),content(1,17,'peer_pressure','title_writing'),content(1,18,'defaults','grammar_correction'),
  style(1,19,'supplemental_dark_patterns','constrained_writing'),style(1,20,'supplemental_dark_patterns','content_matrix'),
];

const R2=[
  style(2,1,'dialogue_trash_can','dialogue_blank'),style(2,2,'listening_choice_design','vocabulary_context'),
  content(2,3,'intro','vocabulary_context'),content(2,4,'intro','title'),content(2,5,'peer_pressure','vocabulary_context'),content(2,6,'peer_pressure','grammar_ab'),
  content(2,7,'designs','blank_phrase'),content(2,8,'designs','grammar_multi'),content(2,9,'designs','constrained_writing'),content(2,10,'designs','title'),
  content(2,11,'peer_pressure','paragraph_order'),content(2,12,'peer_pressure','short_answer'),content(2,13,'defaults','summary_completion'),content(2,14,'defaults','connectors'),
  content(2,15,'defaults','content_false'),content(2,16,'intro','constrained_writing'),
  style(2,17,'supplemental_dark_patterns','grammar_explanation'),style(2,18,'supplemental_dark_patterns','title_writing'),style(2,19,'supplemental_dark_patterns','grammar_count'),style(2,20,'supplemental_dark_patterns','content_false'),
];

const R3=[
  style(3,1,'listening_nutrition','topic'),style(3,2,'dialogue_soap','vocabulary_context'),
  content(3,3,'intro','grammar_count'),content(3,4,'intro','summary_completion'),
  style(3,5,'supplemental_dark_patterns','sentence_insertion'),style(3,6,'supplemental_dark_patterns','topic'),
  content(3,7,'peer_pressure','grammar_multi'),content(3,8,'peer_pressure','topic_writing'),content(3,9,'peer_pressure','vocabulary_context'),content(3,10,'peer_pressure','constrained_writing'),
  content(3,11,'defaults','blank_phrase'),content(3,12,'defaults','grammar_correction'),content(3,13,'defaults','content_false'),
  content(3,14,'designs','connectors'),content(3,15,'designs','vocabulary_context'),content(3,16,'designs','content_true'),
  style(3,17,'supplemental_dark_patterns','constrained_writing'),style(3,18,'supplemental_dark_patterns','grammar_ab'),style(3,19,'supplemental_dark_patterns','title'),
  content(3,20,'designs','topic'),
];

const R4=[
  style(4,1,'listening_cycling','irrelevant_sentence'),style(4,2,'dialogue_soap','content_false'),
  content(4,3,'intro','summary_completion'),content(4,4,'intro','content_matrix'),content(4,5,'designs','summary_completion'),
  content(4,6,'peer_pressure','grammar_multi'),content(4,7,'peer_pressure','sentence_insertion'),content(4,8,'peer_pressure','constrained_writing'),content(4,9,'peer_pressure','title'),
  content(4,10,'defaults','vocabulary_context'),content(4,11,'defaults','constrained_writing'),content(4,12,'defaults','blank_phrase'),
  style(4,13,'supplemental_dark_patterns','vocabulary_context'),style(4,14,'supplemental_dark_patterns','content_matrix'),
  content(4,15,'designs','grammar_single'),content(4,16,'designs','unanswerable'),
  style(4,17,'supplemental_dark_patterns','irrelevant_sentence'),content(4,18,'peer_pressure','blank_phrase'),
  style(4,19,'supplemental_dark_patterns','grammar_ab'),style(4,20,'supplemental_dark_patterns','summary'),
];

export const QUESTION_REFERENCE_MANIFEST=Object.freeze([...R1,...R2,...R3,...R4]);
