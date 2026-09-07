# EP-CB1 符号级抽取管线设计（@flowforge/plugin-codebase）

## 1. 目标

在 EP-CB0 结构层（Project/Folder/File）之上，交付 tree-sitter 符号级抽取管线：对本仓库（TS/JS 主语言）完成全量索引后，知识图谱具备 Function/Method/Class/Interface/Enum/Type/Variable 符号节点、CALLS/DEFINES/DEFINES_METHOD/INHERITS/IMPLEMENTS/USAGE 边、复杂度属性族，并通过 `get_file_outline` / `get_code_snippet` 工具消费。

**决策依据**：D-CB1（web-tree-sitter WASM）、D-CB5（先 TS/TSX/JS）——operator 2026-09-07 裁决。

## 2. 范围

### In scope（EP-CB1）
- web-tree-sitter（WASM）集成：TS/TSX/JS 三语法资产（依赖已安装：web-tree-sitter@0.25、tree-sitter-typescript@0.23、tree-sitter-javascript）
- 符号抽取：Function/Method/Class/Interface/Enum/Type/Variable（模块级）+ 类字段箭头函数（React handler 模式）
- 复杂度属性族计算器（单遍历：cyclomatic/cognitive/loop_count/loop_depth/max_access_depth）
- 边抽取：DEFINES（File→符号）、DEFINES_METHOD（Class→Method）、CALLS（五级解析链）、INHERITS/IMPLEMENTS（TS heritage）、USAGE（模块级变量引用）
- parse_partial 覆盖率上报（tree-sitter ERROR 节点）
- get_file_outline / get_code_snippet 工具 + CLI 子命令
- 存储扩展：QN 精确/后缀查找、文件 outline 查询

### Out of scope（后续批次）
- LSP 语义增强（EP-CB4，D-CB2）；Route 节点抽取（EP-CB3 服务模式识别）；跨仓库边（EP-CB3）；增量索引（EP-CB3）；Cypher（EP-CB3）；162 语言扩展（按需，D-CB5）；MCP 挂接（EP-CB2）；transitive_loop_depth 传播（EP-CB3，依赖 CALLS 边全量——本批先落本地属性）

## 3. 架构：五模块分层

```
src/
├── parser.ts     # T2.1 解析器集成：语言缓存 + parse（同步）+ 语言判定（ts/tsx/js）
├── symbols.ts    # T2.2 符号抽取：AST 迭代 walk（显式栈，类作用域帧）+ 符号节点 + 属性族
├── complexity.ts # T2.2 复杂度计算器：单遍历五指标（C helpers.c L699-769 移植）
├── edges.ts      # T2.3 边解析：注册表（名字→QN 集）+ 五级解析链 + DEFINES/INHERITS
├── outline.ts    # T2.4 文件大纲（按行序的符号列表）+ 代码片段（QN 定位 + 邻居上下文）
├── graph-model.ts # 扩展：Enum/Type 标签 + DEFINES/DEFINES_METHOD/USAGE 边类型
├── store.ts      # 扩展：find_by_qn / qn_suffix / file_outline 查询
├── indexer.ts    # 集成：结构层（EP-CB0 不变）+ 符号层（新增）
├── tools.ts      # 扩展：+get_file_outline / +get_code_snippet（8 工具）
└── cli/main.ts   # 扩展：+outline / +snippet 子命令
```

**异步边界**：`Language.load` 异步（WASM 加载），`parser.parse` 同步。`createCodebaseParser(): Promise<CodebaseParser>` 工厂一次性预加载三语法并缓存（进程级单例）；`indexRepository` 变为 async（CLI/工具层 await）。RAM-first 不变：符号/边先内存聚合再批量事务。

## 4. 核心语义（C 源对照）

### 4.1 符号定位（lang_specs.c L216-253 照搬）

| 集合 | 节点类型 |
|---|---|
| TS func | function_declaration, generator_function_declaration, function_expression, arrow_function, method_definition, function_signature |
| TS class | class_declaration, class, abstract_class_declaration, enum_declaration, interface_declaration, type_alias_declaration, internal_module |
| JS call | call_expression, new_expression |
| 变量 | lexical_declaration, variable_declaration（仅模块级，export_statement 解包） |

标签映射（class_label_for_kind L2826）：interface_declaration→Interface；enum_declaration→Enum；type_alias_declaration→Type；其余→Class。Method：类体内 method/function 值字段（含 public_field_definition+箭头函数）→ QN=`类QN.方法名`，parent_class=类QN（push_method_def L4923 语义）。

### 4.2 QN 规则（cbm_fqn_compute，helpers.c L1508 移植）

`project.路径段点分.name`：扩展名剥离、`index`/`__init__` 文件主干跳过（仅末段且有 name 时）、点文件段前导点剥离（`.github`→`github`）。类作用域内符号 QN 覆盖为 `类QN.name`（extract_defs.c L3680 TS 语义）。嵌套类：`外类QN.内类名`。

### 4.3 复杂度（cbm_compute_complexity，helpers.c L699-769 移植）

单遍历（显式栈，帧携带 branch/loop/access 深度）：
- cyclomatic = 分支节点数（js_branch_types：if/for/for_in/while/switch/case/default/try/catch/do）
- cognitive = Σ(1 + 分支自身嵌套深度)（Campbell 加权）
- loop_count / loop_depth = 命名循环节点计数 / 最大嵌套深度
- max_access_depth = 链式成员/下标访问最大深度（member_expression/subscript_expression）
- param_count = 参数列表命名子节点计数

### 4.4 调用解析（registry.c L1062-1104 五级链移植）

注册表：名字→QN 集（Function/Method/Class/Interface 标签）。解析次序：
1. import_map：本文件导入（local_name→导入源 QN，相对路径解析）
2. same_module：同文件 QN（`文件QN.callee` 或 `类QN.callee`）
3. qualified_suffix：限定名尾匹配（多候选时）
4. unique_name：全库唯一
5. suffix_match：多候选按导入距离择优

**弱成员抑制**（#592/#606 TS 语义）：`x.foo()` 接收者类型未知时不绑定弱短名匹配（防 fabricated edge）；裸调用（`run()`）走全链。this.xxx() 视为类内方法调用（same_module 命中 `类QN.xxx`）。

### 4.5 边类型

| 边 | 语义 | C 对照 |
|---|---|---|
| DEFINES | File→符号 | pass_definitions.c L342 |
| DEFINES_METHOD | Class→Method | L348 |
| CALLS | 调用者→被调 | pass_calls.c |
| INHERITS | 子类→父类（extends） | class heritage |
| IMPLEMENTS | 类→接口（implements） | class heritage |
| USAGE | 引用者→变量/类（非调用引用） | pass_usages.c L240 |

注：34-stage 原文 T2.3 写 CONTAINS_FILE 为笔误，C 语义文件→符号边是 DEFINES（CONTAINS_FILE 是 Folder→File 结构边，EP-CB0 已实现）。本批在 34-stage 勾选时同步勘误。

### 4.6 parse_partial（cbm.c L1657-1678 移植）

`tree.rootNode.hasError` → 收集 ERROR/MISSING 区域 → 上报 phase=parse_partial（覆盖率诚实契约第三态落地）。

### 4.7 get_file_outline / get_code_snippet（mcp.c L9453/L9673 移植）

- outline：入参 file_path（必填）+ labels 过滤 + limit(1-200，默认100)/offset + format(tree|json)；出参行序符号表 {name, label, lines, qn} + total/returned/has_more
- snippet：入参 qualified_name（必填）+ include_neighbors；三级解析（QN 精确→QN 后缀唯一→后缀择优）；出参代码文本 + 行区间 + 歧义建议列表

## 5. 数据契约

符号节点属性：signature（参数列表文本）、return_type、param_count、lines、is_test（文件名/目录含 test/spec）、complexity/cognitive/loop_count/loop_depth/max_access_depth、docstring（前导注释首段）。FTS 索引 name + qn（camelCase 切分沿用 EP-CB0）。

## 6. 测试策略（T1-T9 铁律）

fixture 扩展：mini-repo 增加 symbols/ 语料（类/接口/枚举/方法/字段箭头/模块级变量/调用/继承/实现/导入/递归/嵌套循环/链式访问/ERROR 文件）。真实 parser + 真实 sqlite，禁 Mock。验收基线：本仓库全量索引（8376 文件）无崩溃、符号/边计数>0、outline/snippet 冒烟 exit 0。

## 7. 风险与对策

- **性能**（8376 文件 × WASM 解析）：C 项目 55s 完成结构层；符号层预期数分钟内（单进程顺序解析，RAM-first 落盘）。对策：解析器进程级单例；超大文件沿用 maxFileBytes 跳过契约。
- **依赖审计**：web-tree-sitter 为运行时依赖（D-CB1 裁决）；语法 wasm 经 require.resolve 解析（pnpm junction 兼容）。
- **QN 碰撞**：同名符号 upsert 语义（后写覆盖行级属性，C graph_buffer 同语义）。
