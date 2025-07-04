# TaskPool

高性能任务池调度器，支持最大并发、暂停/恢复、顺序控制、自动提交等功能。

## 安装

```bash
npm install task-pool-coordinator
```

## 类型定义

详见 `type.ts`：

```ts
export interface Task<Args extends any[] = [], T = any> {
  args: Args
  body: (...args: Args) => Promise<T>
  handleDelete?: () => any
}

export type TaskRunning = Task & { seq: number, deleted?: boolean }
```

## 用法示例

```ts
import { TaskPool } from 'task-pool-coordinator'
import type { Task } from 'task-pool-coordinator/type'

const tasks: Task[] = [
  {
    args: [1, 2],
    body: async (a, b) => a + b,
  },
  {
    args: [3, 4],
    body: async (a, b) => a * b,
  },
]

const tc = new TaskPool({
  taskPool: tasks,
  executor: (results) => {
    console.log('全部完成', results)
  },
  concurrency: 2,
  maintainOrder: true,
  immediately: false,
})

tc.start()
```

## 构建与发布

- 使用 Vite 构建，支持 ESM（.mjs）和 CommonJS（.cjs）格式
- 类型声明输出到 `dist/type.d.ts`
- 发布前请运行：

```bash
npm run build
npm publish
```

## API

### TaskPool 构造参数
- `taskPool: Task[]` 任务数组
- `executor: (results, crtResult?, crtIndex?, error?) => any` 结果回调
- `concurrency: number` 最大并发数
- `maintainOrder?: boolean` 是否保持顺序
- `immediately?: boolean` 是否每个任务完成立即回调
- `autoSubmit?: boolean` 是否自动提交
- `submit?: (results) => any` 自动提交函数

### 实例方法
- `addTask(task: Task | Task[])` 添加任务
- `deleteTask(seq: number)` 删除任务
- `start()` 启动调度
- `stop()` 停止并清空
- `setConcurrency(newConcurrency: number)` 动态调整并发
- `reset()` 重置所有状态
- `getStatus()` 获取当前状态
- `pause()` 暂停调度
- `resume()` 恢复调度
- `isPaused()` 是否处于暂停
- `setImmediately(newVal: boolean)` 动态设置immediately 