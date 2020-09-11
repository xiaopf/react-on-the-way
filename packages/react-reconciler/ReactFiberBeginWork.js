// beginWork 为render阶段的主要工作之一，主要做了如下事：
// 根据update更新 state
// 根据update更新 props
// 根据update更新 effectTag
import {
  FunctionComponent,
  ClassComponent,
  IndeterminateComponent,
  HostRoot,
  HostComponent,
  HostText
} from 'shared/ReactWorkTags';
import {
  Placement,
  PerformedWork,
} from 'shared/ReactSideEffectTags';
import { cloneUpdateQueue, processUpdateQueue } from './ReactUpdateQueue';
import { reconcileChildFibers, mountChildFibers, cloneChildFibers } from './ReactChildFiber';
import { renderWithHooks, bailoutHooks } from './ReactFiberHooks';
import {
  mountClassInstance,
  adoptClassInstance,
  constructClassInstance,
  resumeMountClassInstance,
  updateClassInstance
} from './ReactFiberClassComponent';

import { shouldSetTextContent } from 'reactDOM/ReactHostConfig';
import { NoWork } from './ReactFiberExpirationTime';

// 针对没有update需要更新（没有或者优先级不够）的优化路径
let didReceiveUpdate = false;

// 当hook 计算state发现state改变时通过该函数改变didReceiveUpdate
export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true;
}

function reconcileChildren(current, workInProgress, nextChildren, renderExpirationTime) {
  // 首次渲染时只有root节点存在current，所以只有root会进入reconcile产生effectTag
  // 其他节点会appendAllChildren形成DOM树
  if (current) {
    workInProgress.child = reconcileChildFibers(workInProgress, current.child, nextChildren, renderExpirationTime);
  } else {
    workInProgress.child = mountChildFibers(workInProgress, null, nextChildren, renderExpirationTime);
  }
}

function bailoutOnAlreadyFinishedWork(current, workInProgress, renderExpirationTime) {
  const childExpirationTime = workInProgress.childExpirationTime;

  if (childExpirationTime < renderExpirationTime) {
    // 优化路径，通过childExpirationTime跳过对子孙节点的遍历
    // children没有pending的任务，跳过他们
    return null;
  }
  cloneChildFibers(current, workInProgress);
  return workInProgress.child;
}

// 更新HostRoot，
// 遍历update链表，更新state
// 生成child fiber
// 返回child fiber
function updateHostRoot(current, workInProgress, renderExpirationTime) {
  const updateQueue = workInProgress.updateQueue;
  const nextProps = workInProgress.pendingProps;
  const prevState = current.memoizedState;
  const prevChildren = prevState ? prevState.element : null;

  cloneUpdateQueue(current, workInProgress);
  // 根据update链表更新state的操作只在HostRoot 和 class组件相关处理中有
  processUpdateQueue(workInProgress, nextProps, null, renderExpirationTime);

  const nextState = workInProgress.memoizedState;
  const nextChildren = nextState.element;

  if (prevChildren === nextChildren) {
    // 当前root state未变化，走优化路径，不需要协调子节点
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderExpirationTime);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderExpirationTime);
  return workInProgress.child;
}

function updateFunctionComponent(current, workInProgress, Component, nextProps, renderExpirationTime) {
  let nextChildren = renderWithHooks(current, workInProgress, Component, nextProps, renderExpirationTime);

  if (current && !didReceiveUpdate) {
    // 当没有更新产生时的优化路径
    console.log('bail out hook ?');
    bailoutHooks(current, workInProgress, renderExpirationTime);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderExpirationTime);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderExpirationTime);
  return workInProgress.child;
}

function updateClassComponent(current,workInProgress,Component,nextProps,renderExpirationTime) {
  const instance = workInProgress.stateNode;
  let shouldUpdate;
  if (instance === null) {
    if (current !== null) {
      // A class component without an instance only mounts if it suspended
      // inside a non-concurrent tree, in an inconsistent state. We want to
      // treat it like a new mount, even though an empty version of it already
      // committed. Disconnect the alternate pointers.
      current.alternate = null;
      workInProgress.alternate = null;
      // Since this is conceptually a new fiber, schedule a Placement effect
      workInProgress.effectTag |= Placement;
    }
    // In the initial pass we might need to construct the instance.
    constructClassInstance(workInProgress, Component, nextProps);
    mountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
    shouldUpdate = true;
  } else if (current === null) {
    // In a resume, we'll already have an instance we can reuse.
    shouldUpdate = resumeMountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  } else {
    shouldUpdate = updateClassInstance(
      current,
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  }
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    false, //hasContext
    renderExpirationTime,
  );
  return nextUnitOfWork;
}


function forceUnmountCurrentAndReconcile(current,workInProgress,nextChildren,renderExpirationTime) {
  // This function is fork of reconcileChildren. It's used in cases where we
  // want to reconcile without matching against the existing set. This has the
  // effect of all current children being unmounted; even if the type and key
  // are the same, the old child is unmounted and a new child is created.
  //
  // To do this, we're going to go through the reconcile algorithm twice. In
  // the first pass, we schedule a deletion for all the current children by
  // passing null.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    null,
    renderExpirationTime,
  );
  // In the second pass, we mount the new children. The trick here is that we
  // pass null in place of where we usually pass the current child set. This has
  // the effect of remounting all children regardless of whether their
  // identities match.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    null,
    nextChildren,
    renderExpirationTime,
  );
}

function finishClassComponent(current,workInProgress,Component,shouldUpdate,hasContext,renderExpirationTime) {
  // Refs should update even if shouldComponentUpdate returns false
  // markRef(current, workInProgress);

  // const didCaptureError = (workInProgress.effectTag & DidCapture) !== NoEffect;

  if (!shouldUpdate) {
    // Context providers should defer to sCU for rendering
    // if (hasContext) {
    //   invalidateContextProvider(workInProgress, Component, false);
    // }

    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  const instance = workInProgress.stateNode;

  // Rerender
  // ReactCurrentOwner.current = workInProgress;
  let nextChildren;
  // if (
  //   typeof Component.getDerivedStateFromError !== 'function'
  // ) {
  //   // If we captured an error, but getDerivedStateFromError is not defined,
  //   // unmount all the children. componentDidCatch will schedule an update to
  //   // re-render a fallback. This is temporary until we migrate everyone to
  //   // the new API.
  //   // TODO: Warn in a future release.
  //   nextChildren = null;

  //   // if (enableProfilerTimer) {
  //   //   stopProfilerTimerIfRunning(workInProgress);
  //   // }
  // } else {
      nextChildren = instance.render();
  // }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  if (current !== null) {
    // If we're recovering from an error, reconcile without reusing any of
    // the existing children. Conceptually, the normal children and the children
    // that are shown on error are two different sets, so we shouldn't reuse
    // normal children even if their identities match.
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  }

  // Memoize state using the values we just used to render.
  // TODO: Restructure so we never read values from the instance.
  workInProgress.memoizedState = instance.state;

  // The context might have changed so we need to recalculate it.
  // if (hasContext) {
  //   invalidateContextProvider(workInProgress, Component, true);
  // }

  return workInProgress.child;
}
















function updateHostText(current, workInProgress) {
  return null;
}

// 可能是Class/Function Component，需要先mount后才能知道具体类型
function mountIndeterminateComponent(current, workInProgress, Component, renderExpirationTime) {
  if (current) {
    // TODO indeterminate component只会在 suspended的情况下才会有current
    // 暂不处理
  }
  const props = workInProgress.pendingProps;
  const children = renderWithHooks(null, workInProgress, Component, props, renderExpirationTime);
  // TODO ClassComponent
  // 当前只处理了 FunctionComponent
  workInProgress.tag = FunctionComponent;
  reconcileChildren(null, workInProgress, children, renderExpirationTime);
  return workInProgress.child;
}

// 生成 child fiber
// 返回 child fiber
function updateHostComponent(current, workInProgress, renderExpirationTime) {
  // DOM节点名
  const type = workInProgress.type;
  const prevProps = current ? current.memoizedProps : null;
  const nextProps = workInProgress.pendingProps;
  let nextChildren = nextProps.children;

  const isDirectTextChild = shouldSetTextContent(type, nextProps);
  if (isDirectTextChild) {
    // 当前fiber对应的DOM节点只有唯一一个文本子节点，这种情况比较常见，故针对其单独优化
    // 标记其nextChildren为空，省去了再生成一个HostText Fiber并遍历下去的过程
    // 首次渲染该节点的child的处理在completeWork finalizeInitialChildren中
    // 非首次渲染该节点会在completeWork中设置updateQueue并在commitWork中处理
    nextChildren = null;
  }
  // TODO 省去 之前isDirectTextChild 现在不是情况的 diff

  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime
  )
  return workInProgress.child;
}

// render阶段开始处理fiber的入口
// 总体来说该函数会计算新state，返回child
export default function beginWork(current, workInProgress, renderExpirationTime) {

  if (current) {
    // 非首次渲染
    // 对于FiberRoot，首次渲染也存在current，React是通过expirationTime区分是否走优化路径
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (oldProps !== newProps) {
      didReceiveUpdate = true;
    } else if (workInProgress.updateExpirationTime < renderExpirationTime) {
      // 当前fiber的优先级比较低
      didReceiveUpdate = false;
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderExpirationTime);
    } else {
      didReceiveUpdate = false;
    }
  } else {
    didReceiveUpdate = false;
  }

  workInProgress.expirationTime = NoWork;

  switch (workInProgress.tag) {
    case IndeterminateComponent:
      // 首次渲染的Class/Function Component会进入该逻辑，
      // 在函数内部会区分具体类型
      // 如果是FunctionCompoennt，下次渲染就会走 updateFunctionComponent
      return mountIndeterminateComponent(current, workInProgress, workInProgress.type, renderExpirationTime);
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderExpirationTime);
    case FunctionComponent:
      const Component = workInProgress.type;
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderExpirationTime
      );
    case ClassComponent:
      return updateClassComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderExpirationTime,
      );
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderExpirationTime);
    case HostText:
      return updateHostText(current, workInProgress);
    default:
      break;
  }
}