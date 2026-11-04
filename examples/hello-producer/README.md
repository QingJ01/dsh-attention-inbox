# hello-producer

这是按需接入的 Host adapter 示例，不是默认启用的 bundle，不注册模型工具或 prompt，也不在挂载时生成义务。[index.js](index.js) 少于 50 行，展示 `raise`、`withdraw` 和一个 Host action。

调用方导入 `integrateHello(ctx, source)`。`source.subscribe(listener)` 注册事实变更订阅并返回 disposer；发布事实时须等待 listener 返回的 Promise。每条真实业务事实提供 `{ id, title, state }`，只有 `state: 'ready'` 会提交验收义务，其余状态撤回对应义务。`source.accept(id)` 在真实业务系统中执行验收，失败时抛错，条目继续保留。

`integrateHello` 返回 Cordis 可选注入的 disposer；调用方把它绑定自身生命周期。API 注册及义务归属由 `attention` 的 contextual 服务绑定真实 caller，订阅由 `ctx.effect` 清理。此示例只有调用方实际传入 ready 事实才显示内容，不把测试 record 或示例事项算作 M4 的真实义务。

[扩展契约测试](../../tests/extension.test.mjs) 验证行数、零挂载副作用、真实 caller 触发、业务动作失败保留、成功撤回、生命周期清理；TypeScript fixture 通过包的公开 `dsh-attention-inbox/api` 类型入口编译。完整 M4 市集安装/60 秒/卸载验收另见 [008](../../docs/008-acceptance.md)。
