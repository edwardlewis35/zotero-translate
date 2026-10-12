import assert from "node:assert/strict";
import { buildTranslationMessages } from "../src/prompts";

const custom =
  "使用学术语域，保持指定术语。只给一句释义。翻译为 ${targetLanguage}：${sourceText}";
const messages = buildTranslationMessages("“went.”", custom, "简体中文");
assert.equal(messages.length, 2);
assert.equal(messages[0].role, "system");
assert.match(messages[0].content, /完整.*词典条目/u);
assert.match(messages[0].content, /按词性分组/u);
assert.match(messages[0].content, /覆盖主要含义/u);
assert.match(messages[0].content, /每个主要义项至少.*例句/u);
assert.match(messages[0].content, /至少两条例句/u);
assert.match(messages[0].content, /下一行给出 简体中文 译文/u);
assert.match(messages[0].content, /常见搭配、短语、语法限制/u);
assert.match(messages[0].content, /不要.*编造/u);
assert.match(messages[0].content, /自定义提示词.*偏好仍然适用/u);
assert.equal(messages[1].role, "user");
assert.equal(
  messages[1].content,
  "使用学术语域，保持指定术语。只给一句释义。翻译为 简体中文：went",
);

assert.deepEqual(
  buildTranslationMessages("Bank accounts are useful.", custom, "简体中文"),
  [
    {
      role: "user",
      content:
        "使用学术语域，保持指定术语。只给一句释义。翻译为 简体中文：Bank accounts are useful.",
    },
  ],
);
assert.deepEqual(
  buildTranslationMessages("bank account", "保持术语一致", "简体中文"),
  [{ role: "user", content: "保持术语一致\n\n待翻译内容：\nbank account" }],
);
const withoutPlaceholder = buildTranslationMessages(
  "run",
  "使用学习者友好的表达",
  "English",
);
assert.match(withoutPlaceholder[0].content, /用 English 编写/u);
assert.match(withoutPlaceholder[0].content, /English 译文/u);
assert.equal(
  withoutPlaceholder[1].content,
  "使用学习者友好的表达\n\n待翻译内容：\nrun",
);
assert.deepEqual(
  buildTranslationMessages("bank", "译文 ${sourceText}", "中文", "translation"),
  [{ role: "user", content: "译文 bank" }],
);

console.log(
  "Word prompts: dictionary coverage, bilingual examples, custom preferences and unchanged paragraph translation passed",
);
