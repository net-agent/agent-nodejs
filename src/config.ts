import { ServiceInfo } from './services'

export type TunnelInfo = {
  network: 'tcp4'|'tcp6'
  address: string
  password: string
  vhost: string
}

export type Config = {
  tunnel: TunnelInfo
  services: ServiceInfo[]
}