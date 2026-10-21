export interface ServiceStatus {
  stage: string
  service: string
  capabilities: Record<string, boolean>
}

export async function getServiceStatus(signal: AbortSignal): Promise<ServiceStatus> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/status`, {
    signal, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('云服务暂不可用')
  }
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('stage' in data) || typeof data.stage !== 'string'
    || !('service' in data) || typeof data.service !== 'string'
    || !('capabilities' in data) || !data.capabilities || typeof data.capabilities !== 'object' || Array.isArray(data.capabilities)
    || !Object.values(data.capabilities).every(value => typeof value === 'boolean')) {
    throw new Error('云服务响应格式不正确')
  }
  return data as ServiceStatus
}
