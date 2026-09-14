import request from '@/utils/request'

export const brainstormAPI = {
  generateImage(data) {
    return request.post('/brainstorm/images', data, { timeout: 600000 })
  },
  listModels() {
    return request.get('/brainstorm/models', { timeout: 30000 })
  },
}
