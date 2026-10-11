import assert from "node:assert/strict";
import { parseDefinition } from "../src/dictionary/parser";
import { installHTMLDOM } from "./helpers/html";

installHTMLDOM();

// These are invented entries in the exports' structural dialects. No local
// dictionary text or binary fixtures are copied into the repository.
const block = "display:block;";
const normal = "font-weight:normal;font-style:normal;";
const bold = "font-weight:bold;font-style:normal;";
const italic = "font-weight:normal;font-style:italic;";
const pos = (value: string) =>
  `<span style="${block}font-weight:bold;font-style:italic;">${value}</span>`;
const chinese = (value: string) => `<span style="${normal}">${value}</span>`;
const oxfordHead = (word: string) =>
  `<span style="color:#3333CC;${bold}">${word}</span>`;
const example = (english: string, translation: string) =>
  `<span style="${block}${italic}">${english}${chinese(translation)}</span>`;
const oxfordSense = (
  number: number,
  english: string,
  translation: string,
  samples = "",
) =>
  `<span style="${block}${bold}">${number} <span style="${normal}">${english}${chinese(translation)}</span>${samples}</span>`;

const oxford = parseDefinition(
  `${oxfordHead("lu∙men")}
   <span>/ <span>ˈluːmən <a href="sound://sounds%2Flumen_uk.mp3"></a></span>;
   <span>NAmE</span> <span>ˈluːmən <a href="sound://sounds%2Flumen_us.mp3"></a></span> /</span>
   ${pos("noun")}
   <span style="color:#33CC33;${normal}">lumens</span>
   <span style="${normal}"/>
   ${oxfordSense(1, "well made", "制作精良的", example("Mira builds a lumen.", "米拉制作一盏灯。"))}
   ${oxfordSense(2, "a portable light", "便携灯")}
   ${pos("verb")}
   <span style="${normal}">to make a place glow${chinese("使某处发光")}</span>
   ${example("We lumen the room.", "我们使房间明亮。")}
   \u0000`,
  "lumen",
);

assert.equal(oxford.senses.length, 3);
assert.equal(oxford.senses[0].partOfSpeech, "n.");
assert.equal(oxford.senses[0].number, "1");
assert.equal(oxford.senses[0].chinese, "制作精良的");
assert.equal(oxford.senses[0].definition, "well made");
assert.deepEqual(oxford.senses[0].examples, [
  { text: "Mira builds a lumen.", translation: "米拉制作一盏灯。" },
]);
assert.equal(oxford.senses[2].partOfSpeech, "v.");
assert.equal(oxford.senses[2].chinese, "使某处发光");
assert.equal(oxford.senses[2].definition, "to make a place glow");
assert.deepEqual(oxford.pronunciations, [
  { region: "英", text: "/ˈluːmən/", resource: "sounds/lumen_uk.mp3" },
  { region: "美", text: "/ˈluːmən/", resource: "sounds/lumen_us.mp3" },
]);
assert.deepEqual(
  oxford.audioReferences.map(({ resource, region }) => ({ resource, region })),
  [
    { resource: "sounds/lumen_uk.mp3", region: "英" },
    { resource: "sounds/lumen_us.mp3", region: "美" },
  ],
);
assert.deepEqual(oxford.forms, [{ label: "词形", value: "lumens" }]);
assert.ok(oxford.senses[0].translation.includes("制作精良的"));
assert.ok(oxford.senses[0].translation.includes("Mira builds a lumen."));
assert.ok(oxford.senses[0].translation.includes("米拉制作一盏灯。"));
assert.ok(!oxford.senses[0].translation.includes("\u0000"));

const asciiIPA = parseDefinition(
  `${oxfordHead("test")} <span>/<span>test <a href="sound://test.mp3"></a></span>/</span>
   ${pos("noun")}${oxfordSense(1, "a small check", "小检查")}`,
  "test",
);
assert.equal(asciiIPA.pronunciations[0]?.text, "/test/");
assert.equal(asciiIPA.pronunciations[0]?.resource, "test.mp3");

const oxfordNote = parseDefinition(
  `${oxfordHead("lumen")}${pos("noun")}
   <span style="${block}${bold}">1 <span style="${normal}">a portable light${chinese("便携灯")}
   <span style="${normal}"><img src="help.gif">Use this word for portable lights.${chinese("此词用于便携灯。")}</span></span>
   ${example("A lumen fits in a bag.", "便携灯可以放进包里。")}</span>`,
  "lumen",
);
assert.equal(oxfordNote.senses.length, 1);
assert.equal(oxfordNote.senses[0].chinese, "便携灯");
assert.equal(oxfordNote.senses[0].definition, "a portable light");
assert.deepEqual(oxfordNote.senses[0].notes, [
  {
    text: "Use this word for portable lights.",
    translation: "此词用于便携灯。",
  },
]);
assert.equal(oxfordNote.senses[0].examples?.length, 1);
assert.ok(oxfordNote.senses[0].translation.includes("此词用于便携灯。"));

const oxfordInlineDetails = parseDefinition(
  `${oxfordHead("lumen")}${pos("noun")}
   <span style="${normal}">(also <span style="color:#3333CC;${bold}">lumens</span>
   <span style="${normal}">[pl.]</span> especially in BrE)</span>
   <span style="${normal}">a portable light${chinese("便携灯")}</span>
   ${example("A lumen fits in a bag.", "便携灯可以放进包里。")}
   <span style="${normal}">—see also <span style="color:#CC3333;${bold}">warm lumen</span></span>
   ${pos("verb")}<span style="${normal}">to make a room glow${chinese("使房间发光")}</span>
   <span style="${normal}">[<span>V</span>]</span>
   ${example("The room lumens.", "房间发光。")}
   <span style="${normal}">[<span>VN</span>]</span>
   ${example("Mira lumens the room.", "米拉使房间发光。")}
   <span style="${normal}">[also <span>V <b>wh-</b></span>]</span>`,
  "lumen",
);
assert.equal(oxfordInlineDetails.senses.length, 2);
assert.ok(
  oxfordInlineDetails.forms.some(
    (form) => form.label === "复数" && form.value === "lumens",
  ),
);
assert.ok(oxfordInlineDetails.senses[0].translation.includes("warm lumen"));
assert.ok(oxfordInlineDetails.senses[0].translation.includes("see also"));
assert.ok(oxfordInlineDetails.senses[1].translation.includes("[VN]"));
assert.ok(oxfordInlineDetails.senses[1].translation.includes("also V wh-"));
assert.equal(oxfordInlineDetails.senses[1].examples?.length, 2);

const longOxford = parseDefinition(
  `${oxfordHead("lumen")}${pos("noun")}${Array.from(
    { length: 32 },
    (_, index) =>
      oxfordSense(
        index + 1,
        `invented meaning ${index + 1}`,
        `虚构义项${index + 1}`,
        example(`Example ${index + 1}.`, `例句${index + 1}。`),
      ),
  ).join("")}`,
  "lumen",
);
assert.equal(longOxford.senses.length, 32);
assert.equal(longOxford.senses[31].number, "32");
assert.equal(longOxford.senses[31].chinese, "虚构义项32");
assert.equal(longOxford.senses[31].examples?.[0].translation, "例句32。");

const collinsSense = (
  number: number,
  english: string,
  translation: string,
  samples = "",
  supplementary = "",
) =>
  `<div class="collins_en_cn"><div class="caption"><span class="num">${number}</span>
   <span class="st">N-COUNT 可数名词</span><span class="text_blue">${translation}</span>
   ${english}<div id="word_gram_${number}"><div><div>formal</div></div></div></div>
   ${samples}${supplementary}</div>`;
const collinsExample = (english: string, translation: string) =>
  `<ul><li><p>${english}</p><p>${translation}</p></li></ul>`;

const collins = parseDefinition(
  `<div class="collins_content"><font size="+1" color="purple">lumen</font>
   <font color="gold">★★★</font>
   ${collinsSense(
     1,
     "A lumen is a made-up portable light.",
     "便携灯",
     collinsExample(
       'Mira carries a <span class="text_blue">lumen</span>.',
       "米拉带着一盏灯。",
     ),
     `<div class="en_tip">Lumen is also a noun in this invented usage.
     ${collinsExample("That lumen glows.", "那盏灯发光。")}</div>`,
   )}
   ${collinsSense(2, "The past participle of another verb appears in this example.", "另一种用法")}
   <div class="vExplain_s"><p>Use this word sparingly.</p><p>谨慎使用此词。</p></div>
   </div>`,
  "lumen",
);
assert.equal(collins.senses.length, 4);
assert.equal(collins.senses[0].number, "1");
assert.equal(collins.senses[0].partOfSpeech, "n.");
assert.equal(collins.senses[0].chinese, "便携灯");
assert.equal(
  collins.senses[0].definition,
  "A lumen is a made-up portable light.",
);
assert.ok(collins.senses[0].labels?.includes("formal"));
assert.deepEqual(collins.senses[0].examples, [
  { text: "Mira carries a lumen.", translation: "米拉带着一盏灯。" },
]);
assert.equal(collins.senses[1].heading, "补充用法");
assert.deepEqual(collins.senses[1].examples, [
  { text: "That lumen glows.", translation: "那盏灯发光。" },
]);
assert.equal(collins.senses[3].heading, "用法说明");
assert.equal(collins.senses[3].chinese, "谨慎使用此词。");
assert.equal(collins.senses[3].definition, "Use this word sparingly.");
assert.deepEqual(collins.pronunciations, []);
assert.deepEqual(collins.audioReferences, []);
assert.deepEqual(collins.forms, []);
assert.deepEqual(collins.tags, ["3 星词汇"]);
assert.equal(
  collins.senses
    .flatMap((sense) => sense.examples || [])
    .filter((item) => item.text === "That lumen glows.").length,
  1,
);

const collinsNotes = parseDefinition(
  `<div class="collins_content">${collinsSense(
    1,
    "An invented word.",
    "虚构词",
    "",
    `<div class="en_tip"><p>Lumen may be omitted.</p><p>lumen可省略。</p></div>`,
  )}
   <div class="vEn_tip"><p>A lumen describes a light.</p><p>lumen用于描述灯。</p></div>
   <div class="vExplain_s">The label is optional. lumen可作为可选标签。</div>
   <div class="vEn_tip"><p>Lumen and lamp describe lights.</p><p>lumen 和 lamp 均用于灯。可以说 Mira packs a lumen, Niko packs a lamp。</p></div>
   </div>`,
  "lumen",
);
assert.equal(collinsNotes.senses.length, 5);
assert.equal(collinsNotes.senses[1].heading, "补充用法");
assert.equal(collinsNotes.senses[1].definition, "Lumen may be omitted.");
assert.equal(collinsNotes.senses[1].chinese, "lumen可省略。");
assert.equal(collinsNotes.senses[1].examples?.length, 0);
assert.equal(collinsNotes.senses[2].heading, "用法说明");
assert.equal(collinsNotes.senses[2].definition, "A lumen describes a light.");
assert.equal(collinsNotes.senses[2].chinese, "lumen用于描述灯。");
assert.equal(collinsNotes.senses[3].definition, "The label is optional.");
assert.equal(collinsNotes.senses[3].chinese, "lumen可作为可选标签。");
assert.equal(
  collinsNotes.senses[4].definition,
  "Lumen and lamp describe lights.",
);
assert.equal(
  collinsNotes.senses[4].chinese,
  "lumen 和 lamp 均用于灯。可以说 Mira packs a lumen, Niko packs a lamp。",
);

const collinsGroups = parseDefinition(
  `<div class="part_list"><ul><li>1. LIGHTS 光源</li><li>2. DEVICES 装置</li></ul></div>
   <div class="part_main"><h3 class="menu_switch" mid="1"></h3>
   <div id="menu_1" class="collins_content">${collinsSense(1, "An invented light.", "虚构灯")}</div>
   <h3 class="menu_switch" mid="2"></h3>
   <div id="menu_2">${collinsSense(1, "An invented device.", "虚构装置")}</div></div>`,
  "lumen",
);
assert.equal(collinsGroups.senses.length, 2);
assert.equal(collinsGroups.senses[0].number, "1");
assert.equal(collinsGroups.senses[0].heading, "光源");
assert.equal(collinsGroups.senses[1].number, "1");
assert.equal(collinsGroups.senses[1].heading, "装置");

const longCollins = parseDefinition(
  `<div class="collins_content">${Array.from({ length: 40 }, (_, index) =>
    collinsSense(
      index + 1,
      `An invented meaning ${index + 1}.`,
      `虚构释义${index + 1}`,
      collinsExample(
        `Invented example ${index + 1}.`,
        `虚构例句${index + 1}。`,
      ),
    ),
  ).join("")}</div>`,
  "lumen",
);
assert.equal(longCollins.senses.length, 40);
assert.equal(longCollins.senses[39].number, "40");
assert.equal(longCollins.senses[39].examples?.[0].translation, "虚构例句40。");
assert.ok(longCollins.senses[39].translation.includes("Invented example 40."));

console.log(
  JSON.stringify({
    oxfordSenses: oxford.senses.length,
    collinsSenses: collins.senses.length,
    longOxfordSenses: longOxford.senses.length,
    longCollinsSenses: longCollins.senses.length,
    pairedExamples: "preserved",
    fabricatedFields: "absent",
  }),
);
