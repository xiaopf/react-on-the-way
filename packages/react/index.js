import {createElement} from './ReactElement';
import ReactCurrentDispatcher from './ReactCurrentDispatcher';
import {useState, useEffect} from './ReactHooks';
import {Component} from './ReactBaseClasses';
const React = {
  createElement,
  Component,
  // 用于保存内部使用的一些变量，方便在模块间引用
  internals: {
    ReactCurrentDispatcher
  },
  useState,
  useEffect
}

export default React;