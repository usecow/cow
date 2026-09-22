export interface ResourceRequest { readonly id: string; readonly url: string; readonly method: string; readonly headers: Readonly<Record<string, unknown>> }
export interface WorkerContext { readonly worker: Readonly<{ id: number }> }
export interface AcquireContext<Options> { readonly options: Options; readonly request: ResourceRequest; readonly signal: AbortSignal }
export interface ReleaseContext<Options, Resource> extends AcquireContext<Options> { readonly resource: Resource; readonly error: unknown | null }
export interface ResourceDefinition<Options, Resource, Facade = Resource> {
  name: string
  key(options: Options): string
  open(options: Options, context: WorkerContext): Resource | Promise<Resource>
  acquire?(resource: Resource, context: AcquireContext<Options>): Facade | Promise<Facade>
  release?(facade: Facade, context: ReleaseContext<Options, Resource>): void | Promise<void>
  beforeResponse?(facade: Facade): void
  close(resource: Resource, context: WorkerContext): void | Promise<void>
}
/** Native adapter entry points only, never ordinary pages or helper modules. */
export function defineResource<Options, Resource, Facade = Resource>(definition: ResourceDefinition<Options, Resource, Facade>): (options?: Options) => Promise<Facade>
export const resourceProtocolVersion: number
