import request from '@/utils/request'

export const brainstormAPI = {
  generateImage(data) {
    return request.post('/brainstorm/images', data, { timeout: 600000 })
  },
}
