export interface Task<Args extends any[] = [], T = any> {
  args: Args
  body: (...args: Args) => Promise<T>
  handleDelete?: () => any
}

export type TaskRunning = Task & { seq: number, deleted?: boolean } 