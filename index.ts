export type { Task, TaskRunning } from './type'
import type { Task, TaskRunning } from './type'

function isArray(arr: any) {
  return Array.isArray(arr)
}

/* 面向对象任务池子 */
export class TaskPool {
  // 塞入任务池的总任务索引（用于分配唯一seq）
  private index = 0
  // 最大并发数
  private concurrency: number
  // 所有任务（含已完成、未开始、进行中）
  private allTasks: Array<Task & { seq: number }> = []
  // 正在执行的任务池
  private runningPool: TaskRunning[] = []
  // 是否维持结果顺序和任务一致（不按结束时间排序）
  private maintainOrder = false
  // 已完成任务的结果池
  private resultPool: { seq: number, result: any, status: 'success' | 'error' }[] = []
  // 未开始任务池
  private restPool: Array<Task & { seq: number }> = []
  // 任务池是否正在运行（防止start重复调度）
  private isRunning = false
  // 任务池是否处于暂停状态
  private paused = false
  // 任务调度执行器
  private readonly executorFn: () => void
  // 添加任务（支持单个/批量）
  public readonly addTask: (newTask: Task | Task[]) => void
  // 删除任务（支持未开始、进行中、已完成三种状态）
  public readonly deleteTask: (index: number) => void
  // 启动任务池调度
  public readonly start: () => void
  // 停止任务池（清空未开始和进行中任务）
  public readonly stop: () => void
  // 设置最大并发数
  public readonly setConcurrency: (newConcurrency: number) => void
  // 重置任务池（彻底清空所有状态）
  public readonly reset: () => void
  // 获取所有任务
  public readonly getAllTasks: () => Array<Task & { seq: number }>
  // 获取任务池当前状态
  public readonly getStatus: () => {
    total: number
    running: number
    waiting: number
    finished: number
    results: { seq: number, result: any, status: 'success' | 'error' }[]
    paused: boolean
  }

  // 暂停任务池调度（不再调度新任务，已在执行的任务可继续完成）
  public readonly pause: () => void
  // 恢复任务池调度（从暂停点继续补满并发池）
  public readonly resume: () => void
  // 判断任务池是否处于暂停状态
  public readonly isPaused: () => boolean
  // 是否立即回调executor，可动态修改
  public immediately: boolean
  private autoSubmit: boolean
  private submit?: (results: { seq: number, result: any, status: 'success' | 'error' }[]) => any | Promise<any>
  /**
   * 动态设置immediately属性
   * @param newVal 是否立即回调executor
   */
  public setImmediately(newVal: boolean) {
    this.immediately = newVal
  }

  /***
   * 任务池执行器
   * @param options 解构对象参数
   *   - taskPool: 任务数组
   *   - executor: 结果回调
   *   - concurrency: 最大并发数
   *   - maintainOrder: 是否保持顺序
   *   - immediately: 是否立即回调executor
   *   - autoSubmit: 是否自动提交
   *   - submit: 自动提交函数
   */
  constructor({
    taskPool,
    executor,
    concurrency,
    maintainOrder = false,
    immediately = false,
    autoSubmit = false,
    submit,
  }: {
    taskPool: Task[]
    executor?: (totalResult: { seq: number, result: any, status: 'success' | 'error' }[], crtResult?: any, crtIndex?: number, error?: any) => any
    concurrency: number
    maintainOrder?: boolean
    immediately?: boolean
    autoSubmit?: boolean
    submit?: (results: { seq: number, result: any, status: 'success' | 'error' }[]) => any | Promise<any>
  }) {
    this.concurrency = concurrency
    this.maintainOrder = maintainOrder
    this.index = 0
    this.immediately = immediately
    this.autoSubmit = autoSubmit
    this.submit = submit
    // 初始化任务池，分配唯一seq
    this.allTasks = taskPool.map(m => ({ ...m, seq: this.index++ }))
    this.restPool = this.allTasks.slice()
    // 任务调度主逻辑：批量补满并发池，支持暂停
    this.executorFn = async () => {
      // 若处于暂停状态，直接返回，不调度新任务
      if (this.paused)
        return
      while (this.restPool.length && this.runningPool.length < this.concurrency) {
        const task = this.restPool.shift()
        if (task) {
          const proxyTask = { body: task.body, args: task.args, seq: task.seq, deleted: false }
          this.runningPool.push(proxyTask)
          // 执行任务体，异步处理结果
          proxyTask
            ?.body(...proxyTask.args)
            .then((crtRes) => {
              if (!proxyTask.deleted) {
                this.resultPool.push({ seq: proxyTask.seq, result: crtRes, status: 'success' })
                if (immediately && executor) {
                  executor(this.resultPool, crtRes, proxyTask.seq)
                }
                // 移除已完成任务，递归补位
                this.runningPool = this.runningPool.filter(
                  f => f.seq !== proxyTask.seq,
                )
                this.executorFn()
              }
            })
            .catch((err) => {
              if (!proxyTask.deleted) {
                this.resultPool.push({ seq: proxyTask.seq, result: err, status: 'error' })
                this.runningPool = this.runningPool.filter(
                  f => f.seq !== proxyTask.seq,
                )
                if (immediately && executor) {
                  executor(this.resultPool, undefined, proxyTask.seq, err)
                }
                console.error(`🐛！taskPoolExecutor:任务${proxyTask.seq}执行出错`, err)
                this.executorFn()
              }
            })
        }
      }
      // 全部任务完成后，统一回调executor
      if (this.restPool.length === 0 && this.runningPool.length === 0) {
        if (!immediately && executor) {
          executor(this.maintainOrder ? this.resultPool.sort((a, b) => a.seq - b.seq) : this.resultPool)
        }
        // autoSubmit逻辑
        if (this.autoSubmit && this.submit) {
          const results = this.maintainOrder ? this.resultPool.sort((a, b) => a.seq - b.seq) : this.resultPool
          Promise.resolve(this.submit(results)).finally(() => {
            this.reset()
          })
        }
      }
    }
    // 添加任务（支持单个/批量），自动分配唯一seq
    this.addTask = (task: Task | Task[]) => {
      if (isArray(task)) {
        const tasksWithSeq = (task as Task[]).map(m => ({ ...m, seq: this.index++ }))
        this.restPool.push(...tasksWithSeq)
        this.allTasks.push(...tasksWithSeq)
      }
      else {
        const taskWithSeq = { ...task, seq: this.index++ }
        this.restPool.push(taskWithSeq)
        this.allTasks.push(taskWithSeq)
      }
      this.executorFn()
    }
    // 删除任务，支持未开始、进行中、已完成三种状态
    this.deleteTask = (seq: number) => {
      /* 分为删除已完成任务、未开始任务、进行中任务 */
      /* 删除进行中任务 */
      const runningTask = this.runningPool.find(f => f.seq === seq)
      if (runningTask) {
        runningTask.deleted = true
        this.runningPool = this.runningPool.filter(f => f.seq !== seq)
        this.allTasks = this.allTasks.filter(f => f.seq !== seq)
        runningTask.handleDelete?.()
        this.executorFn()
      }
      else {
        /* 删除未开始任务 */
        const restTask = this.restPool.find(f => f.seq === seq)
        if (restTask) {
          this.restPool = this.restPool.filter(f => f.seq !== seq)
          this.allTasks = this.allTasks.filter(f => f.seq !== seq)
          restTask.handleDelete?.()
        }
        else {
          /* 删除已完成任务 */
          const doneTarget = this.allTasks.find(f => f.seq === seq)
          if (doneTarget) {
            doneTarget.handleDelete?.()
            this.allTasks = this.allTasks.filter(f => f.seq !== seq)
            this.resultPool = this.resultPool.filter(f => f.seq !== seq)
          }
        }
        this.executorFn()
      }
    }
    // 停止任务池：清空未开始和进行中任务，重置运行/暂停状态
    this.stop = () => {
      this.restPool = []
      this.runningPool = []
      this.isRunning = false
      this.paused = false
    }
    // 重置任务池：彻底清空所有状态
    this.reset = () => {
      this.index = 0
      this.allTasks = []
      this.runningPool = []
      this.resultPool = []
      this.restPool = []
      this.isRunning = false
      this.paused = false
    }
    // 启动任务池调度，幂等保护
    this.start = () => {
      if (this.isRunning)
        return
      this.isRunning = true
      this.executorFn()
      this.isRunning = false
    }
    // 动态调整最大并发数
    this.setConcurrency = (newConcurrency: number) => {
      this.concurrency = newConcurrency
    }
    // 获取任务池当前状态，含暂停标记
    this.getStatus = () => {
      return {
        total: this.allTasks.length,
        running: this.runningPool.length,
        waiting: this.restPool.length,
        finished: this.resultPool.length,
        results: this.resultPool.slice(),
        paused: this.paused,
      }
    }
    // 暂停任务池调度（不再调度新任务，已在执行的任务可继续完成）
    this.pause = () => {
      this.paused = true
    }
    // 恢复任务池调度（从暂停点继续补满并发池）
    this.resume = () => {
      if (!this.paused)
        return
      this.paused = false
      this.executorFn()
    }
    // 判断任务池是否处于暂停状态
    this.isPaused = () => {
      return this.paused
    }
    // 获取所有任务
    this.getAllTasks = () => {
      return this.allTasks
    }
  }
}
