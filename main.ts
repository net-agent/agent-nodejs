import { VNet } from './src/vnet'
import { Cluster } from './src/cluster'
import { runPortproxy } from './src/services'


main()

async function main() {
  let addr = 'localhost:2035'
  let secret = ''
  let vhost = 'nodets_test'

  let vnet = await VNet.connect(addr, secret)
  let cluster = new Cluster(vnet)

  try {
    let resp = await cluster.login(vhost)
    vhost = resp.vhost
    console.log('login success', resp)
    cluster.startHeartbeat()
  } catch (ex) {
    console.log('login failed', ex)
  }

  let svc = runPortproxy(vnet, cluster, 'localhost:1082', 'test.tunnel:1081')
  svc.on('error', err => {
    console.log('portproxy has error: ', err)
  })
}
