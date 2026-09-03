import type { LearningAssessmentQuestionSetPublication } from "@/modules/learning-assessment/domain/assessment";
import type { LearningMapPublication } from "@/modules/learning-catalog/domain/learning-map";

export const DEMO_DISCLOSURE = "本地演示样本，不是生产精选或真实供应方成功证据";
export const DEMO_EMAIL = "demo@zhijing.local";
export const DEMO_PASSWORD = "Zhijing-demo-only-2026";
export const DEMO_USER_NAME = `${DEMO_DISCLOSURE}｜演示用户`;
export const DEMO_MAP_ID = "local-demo-typescript-map";
export const DEMO_VERSION_ID = "local-demo-typescript-map-v1";
export const DEMO_QUESTION_SET_ID = "local-demo-typescript-questions-v1";

const COURSE_SOURCE_ID = "local-demo-source-course";
const GENERICS_SOURCE_ID = "local-demo-source-generics";
const TYPE_OPERATIONS_SOURCE_ID = "local-demo-source-type-operations";

export const DEMO_MAP_PUBLICATION: LearningMapPublication = {
  mapId: DEMO_MAP_ID,
  versionId: DEMO_VERSION_ID,
  title: `${DEMO_DISCLOSURE}｜TypeScript 泛型与类型操作学习地图`,
  summary: `${DEMO_DISCLOSURE}。内容仅依据列出的三条知乎公开页面整理，用于体验加入地图、按线性先修关系学习、完成节点验证和查看报告。`,
  featuredPosition: 90,
  sources: [
    {
      sourceId: COURSE_SOURCE_ID,
      title: `${DEMO_DISCLOSURE}｜前端 TypeScript 入门教程 - 66. 泛型-HelloWorld`,
      excerpt:
        "知乎知学堂课程从官网知识点和案例入门 TypeScript，课程含基础、高级、案例和项目篇；当前公开小节为“泛型-HelloWorld”。",
      url: "https://www.zhihu.com/education/video-course/1487063048279662592?section_id=1487070022975930368",
      authorName: "知乎知学堂（讲师：千锋教育）",
    },
    {
      sourceId: GENERICS_SOURCE_ID,
      title: `${DEMO_DISCLOSURE}｜TypeScript Learning Notes - Generics`,
      excerpt:
        "文章以 identity 函数说明泛型如何捕获输入类型并保留返回值类型信息，并介绍类型推断、泛型类型、泛型类和泛型约束。",
      url: "https://www.zhihu.com/en/article/636152620",
      authorName: "tiny",
    },
    {
      sourceId: TYPE_OPERATIONS_SOURCE_ID,
      title: `${DEMO_DISCLOSURE}｜TypeScript Learning Notes - Type Operations`,
      excerpt:
        "文章介绍如何基于已有类型或值表达新类型，覆盖 keyof、类型上下文中的 typeof、索引访问类型和条件类型等操作。",
      url: "https://www.zhihu.com/en/article/636135140",
      authorName: "tiny",
    },
  ],
  nodes: [
    {
      nodeId: "local-demo-node-1-generic-identity",
      title: `${DEMO_DISCLOSURE}｜1. 泛型 identity 保留类型信息`,
      learningObjective:
        "理解 Type 作为类型变量如何同时描述 identity 的参数和返回值，区分泛型与会丢失返回值类型信息的 any。",
      sourceIds: [COURSE_SOURCE_ID, GENERICS_SOURCE_ID],
      viewpoints: [
        {
          viewpointId: "local-demo-viewpoint-1",
          kind: "consensus",
          statement:
            "identity<Type>(arg: Type): Type 会把调用者提供的类型信息从参数传递到返回值，而 any 无法保留这种对应关系。",
          conditions: null,
          sourceIds: [GENERICS_SOURCE_ID],
        },
      ],
    },
    {
      nodeId: "local-demo-node-2-inference",
      title: `${DEMO_DISCLOSURE}｜2. 类型参数推断与显式传入`,
      learningObjective:
        "能够说明显式写出类型参数和由实参推断类型参数这两种泛型调用方式，以及复杂场景下显式参数的作用。",
      sourceIds: [COURSE_SOURCE_ID, GENERICS_SOURCE_ID],
      viewpoints: [
        {
          viewpointId: "local-demo-viewpoint-2",
          kind: "practical_experience",
          statement:
            "类型参数推断通常能让代码更短、更易读；编译器无法推断时，可以显式传入类型参数。",
          conditions: null,
          sourceIds: [GENERICS_SOURCE_ID],
        },
      ],
    },
    {
      nodeId: "local-demo-node-3-constraints",
      title: `${DEMO_DISCLOSURE}｜3. 泛型约束与 keyof`,
      learningObjective:
        "理解 extends 约束如何保证泛型值具备所需成员，并能用 Key extends keyof Type 限制对象属性名。",
      sourceIds: [GENERICS_SOURCE_ID, TYPE_OPERATIONS_SOURCE_ID],
      viewpoints: [
        {
          viewpointId: "local-demo-viewpoint-3",
          kind: "consensus",
          statement:
            "约束让泛型函数只接受具备指定结构的类型；Key extends keyof Type 可阻止访问对象上不存在的属性。",
          conditions: null,
          sourceIds: [GENERICS_SOURCE_ID, TYPE_OPERATIONS_SOURCE_ID],
        },
      ],
    },
    {
      nodeId: "local-demo-node-4-indexed-access",
      title: `${DEMO_DISCLOSURE}｜4. typeof 与索引访问类型`,
      learningObjective:
        "区分值上下文与类型上下文中的 typeof，并组合 typeof、number 索引和属性索引提取已有值的类型。",
      sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      viewpoints: [
        {
          viewpointId: "local-demo-viewpoint-4",
          kind: "supplementary",
          statement:
            "类型上下文中的 typeof 可引用变量或属性的类型；索引访问类型可进一步取得对象属性或数组元素的类型。",
          conditions: null,
          sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
        },
      ],
    },
    {
      nodeId: "local-demo-node-5-conditional",
      title: `${DEMO_DISCLOSURE}｜5. 条件类型表达输入输出关系`,
      learningObjective:
        "读懂 SomeType extends OtherType ? TrueType : FalseType，并理解条件类型与泛型组合后如何表达输入和输出类型的关系。",
      sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      viewpoints: [
        {
          viewpointId: "local-demo-viewpoint-5",
          kind: "practical_experience",
          statement:
            "条件类型与泛型组合，可以用一个类型表达随输入类型变化的输出类型，减少为每种输入重复编写重载。",
          conditions: null,
          sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
        },
      ],
    },
  ],
  prerequisites: [
    {
      nodeId: "local-demo-node-2-inference",
      prerequisiteNodeId: "local-demo-node-1-generic-identity",
    },
    {
      nodeId: "local-demo-node-3-constraints",
      prerequisiteNodeId: "local-demo-node-2-inference",
    },
    {
      nodeId: "local-demo-node-4-indexed-access",
      prerequisiteNodeId: "local-demo-node-3-constraints",
    },
    {
      nodeId: "local-demo-node-5-conditional",
      prerequisiteNodeId: "local-demo-node-4-indexed-access",
    },
  ],
};

export const DEMO_QUESTION_SET_PUBLICATION: LearningAssessmentQuestionSetPublication =
  {
    questionSetId: DEMO_QUESTION_SET_ID,
    versionId: DEMO_VERSION_ID,
    questions: [
      {
        questionId: "local-demo-question-1-identity",
        nodeId: "local-demo-node-1-generic-identity",
        type: "single_choice",
        prompt: "哪一个 identity 签名能保留参数类型与返回值类型的对应关系？",
        explanation:
          "材料使用 function identity<Type>(arg: Type): Type 捕获输入类型，并将相同类型用于返回值。",
        options: [
          { optionId: "q1-any", label: "(arg: any) => any" },
          { optionId: "q1-generic", label: "<Type>(arg: Type) => Type" },
          { optionId: "q1-number", label: "(arg: number) => string" },
        ],
        correctOptionIds: ["q1-generic"],
        sourceIds: [GENERICS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-2-information",
        nodeId: "local-demo-node-1-generic-identity",
        type: "opinion_analysis",
        prompt: "如何判断“any 与 identity 泛型同样精确”这一说法？",
        explanation:
          "文章指出 any 虽接受各种类型，却丢失返回值的类型信息；泛型 identity 保留输入与输出之间的类型联系。",
        options: [
          { optionId: "q2-accurate", label: "准确，二者都完整保留返回值类型" },
          {
            optionId: "q2-inaccurate",
            label: "不准确，any 会丢失返回值类型信息",
          },
        ],
        correctOptionIds: ["q2-inaccurate"],
        sourceIds: [GENERICS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-3-inference",
        nodeId: "local-demo-node-2-inference",
        type: "multiple_choice",
        prompt: "材料描述了哪些调用泛型 identity 的方式？",
        explanation:
          '文章同时展示 identity<string>("myString") 与 identity("myString")，后者由编译器推断类型参数。',
        options: [
          { optionId: "q3-explicit", label: "显式传入类型参数" },
          { optionId: "q3-inferred", label: "由值实参推断类型参数" },
          { optionId: "q3-runtime", label: "在运行时读取类型参数" },
        ],
        correctOptionIds: ["q3-explicit", "q3-inferred"],
        sourceIds: [GENERICS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-4-inference-limit",
        nodeId: "local-demo-node-2-inference",
        type: "single_choice",
        prompt: "材料建议在什么情况下考虑显式传入类型参数？",
        explanation:
          "类型推断通常更简洁，但复杂示例中编译器无法推断时可能需要显式传入。",
        options: [
          { optionId: "q4-never", label: "任何情况下都禁止显式传入" },
          { optionId: "q4-complex", label: "编译器在复杂场景中无法推断时" },
          { optionId: "q4-runtime", label: "需要改变 JavaScript 运行时值时" },
        ],
        correctOptionIds: ["q4-complex"],
        sourceIds: [GENERICS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-5-constraint",
        nodeId: "local-demo-node-3-constraints",
        type: "matching",
        prompt: "将材料中的泛型写法与它保证的关系配对。",
        explanation:
          "Type extends Lengthwise 保证 length 成员；Key extends keyof Type 保证 Key 是 Type 的已知键。",
        options: [
          { optionId: "q5-lengthwise", label: "Type extends Lengthwise" },
          { optionId: "q5-keyof", label: "Key extends keyof Type" },
          { optionId: "q5-has-length", label: "参数具有 length 成员" },
          { optionId: "q5-known-key", label: "属性名属于对象已知键" },
        ],
        correctMatches: [
          { leftOptionId: "q5-lengthwise", rightOptionId: "q5-has-length" },
          { leftOptionId: "q5-keyof", rightOptionId: "q5-known-key" },
        ],
        sourceIds: [GENERICS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-6-keyof",
        nodeId: "local-demo-node-3-constraints",
        type: "single_choice",
        prompt:
          "对 type Point = { x: number; y: number } 使用 keyof Point 会得到什么？",
        explanation:
          "类型操作文章说明 keyof 对象类型产生其键的字符串或数字字面量联合。",
        options: [
          { optionId: "q6-values", label: "number" },
          { optionId: "q6-keys", label: '"x" | "y"' },
          { optionId: "q6-object", label: "Point" },
        ],
        correctOptionIds: ["q6-keys"],
        sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-7-typeof",
        nodeId: "local-demo-node-4-indexed-access",
        type: "opinion_analysis",
        prompt:
          "如何判断“ReturnType<f> 可以直接用函数值 f 作为类型参数”这一说法？",
        explanation:
          "文章区分值和类型；引用函数值 f 的类型应写 typeof f，因此示例使用 ReturnType<typeof f>。",
        options: [
          {
            optionId: "q7-accurate",
            label: "准确，值名在类型位置总会自动转换",
          },
          {
            optionId: "q7-inaccurate",
            label: "不准确，应使用 ReturnType<typeof f>",
          },
        ],
        correctOptionIds: ["q7-inaccurate"],
        sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-8-indexed",
        nodeId: "local-demo-node-4-indexed-access",
        type: "multiple_choice",
        prompt: "材料展示了哪些合法的索引访问类型用途？",
        explanation:
          "文章展示了按属性键、键联合、keyof，以及 typeof Array[number] 等方式取得已有类型的一部分。",
        options: [
          { optionId: "q8-property", label: 'Person["age"] 取得属性类型' },
          {
            optionId: "q8-array",
            label: "typeof MyArray[number] 取得数组元素类型",
          },
          { optionId: "q8-missing", label: 'Person["alve"] 静默产生 unknown' },
        ],
        correctOptionIds: ["q8-property", "q8-array"],
        sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-9-conditional-form",
        nodeId: "local-demo-node-5-conditional",
        type: "single_choice",
        prompt: "哪一项是材料给出的条件类型基本形式？",
        explanation:
          "条件类型写作 SomeType extends OtherType ? TrueType : FalseType。",
        options: [
          {
            optionId: "q9-conditional",
            label: "SomeType extends OtherType ? TrueType : FalseType",
          },
          {
            optionId: "q9-value-if",
            label: "if (SomeType) TrueType else FalseType",
          },
          { optionId: "q9-keyof", label: "keyof SomeType = OtherType" },
        ],
        correctOptionIds: ["q9-conditional"],
        sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      },
      {
        questionId: "local-demo-question-10-overloads",
        nodeId: "local-demo-node-5-conditional",
        type: "opinion_analysis",
        prompt: "如何判断“条件类型与泛型组合只能增加函数重载数量”这一说法？",
        explanation:
          "文章以 createLabel 为例，用条件类型表达输入和输出关系，将多个重载简化为一个泛型函数签名。",
        options: [
          {
            optionId: "q10-accurate",
            label: "准确，条件类型要求为每种输入增加重载",
          },
          { optionId: "q10-inaccurate", label: "不准确，它可以减少重复重载" },
        ],
        correctOptionIds: ["q10-inaccurate"],
        sourceIds: [TYPE_OPERATIONS_SOURCE_ID],
      },
    ],
  };

export class DemoContentConflictError extends Error {
  constructor(readonly objectName: string) {
    super(
      `Existing ${objectName} is not exactly the fixed local Demo object; refusing to overwrite immutable or non-Demo data`,
    );
    this.name = "DemoContentConflictError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function classifyExistingDemoObject(
  objectName: string,
  expected: unknown,
  existing: unknown | null,
): "missing" | "equivalent" {
  if (existing === null) {
    return "missing";
  }
  if (
    JSON.stringify(canonicalize(existing)) ===
    JSON.stringify(canonicalize(expected))
  ) {
    return "equivalent";
  }
  throw new DemoContentConflictError(objectName);
}
