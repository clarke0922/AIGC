<template>
  <div class="app">
    <nav v-if="$route.name !== 'studio'" class="workspace-entry" aria-label="工作台切换">
      <span>当前：原版工作台</span>
      <router-link to="/">进入简易工作台 →</router-link>
      <small>口述故事 · 五步制作 · 预算与版本管理</small>
    </nav>
    <router-view />
  </div>
</template>

<script setup lang="ts">
</script>

<style>
.workspace-entry {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 24px;
  background: #19251e;
  color: #e8e6df;
  border-bottom: 1px solid #465344;
  font-size: 14px;
}
.workspace-entry a {
  padding: 9px 16px;
  border-radius: 6px;
  background: #d3edb6;
  color: #19251a;
  font-weight: 600;
  text-decoration: none;
}
.workspace-entry a:focus-visible { outline: 2px solid white; outline-offset: 3px; }
.workspace-entry small { color: #bac5bc; }
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  transition: background 0.25s, color 0.25s;
}
</style>
