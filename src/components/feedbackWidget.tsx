import React, {useCallback, useEffect} from 'react';
import * as Sentry from '@sentry/browser';

import {FeebdackButton} from './feedbackButton';
import {FeedbackModal} from './feedbackModal';
import {Rect} from './screenshotEditor';

function containsRect(bounds: DOMRect, rect: Rect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.right &&
    rect.y + rect.height <= bounds.bottom
  );
}

function containsBounds(a: DOMRect, b: DOMRect): boolean {
  return a.x <= b.x && a.y <= b.y && a.right >= b.right && a.bottom >= b.bottom;
}

function getSelectedDomElement(selection: Rect): HTMLElement | null {
  const feedbackModal = document.getElementById('feedbackModal');
  // reduce selection by 30px as a workaround for the selection being too large
  const reducedSelection = {
    x: selection.x + 30,
    y: selection.y + 30,
    width: selection.width - 60,
    height: selection.height - 60,
  };

  // Retrieve all elements at the center of the selection
  const elements = document
    .elementsFromPoint(
      reducedSelection.x + reducedSelection.width / 2,
      reducedSelection.y + reducedSelection.height / 2
    )
    .filter(element => element !== feedbackModal && !feedbackModal?.contains(element));

  // Get the smallest element that contains the entire selection
  let selectedElement = null;
  for (const element of elements) {
    const elementBounds = element.getBoundingClientRect();
    const selectedElementBounds = selectedElement?.getBoundingClientRect();
    if (
      containsRect(elementBounds, reducedSelection) &&
      (selectedElement === null || containsBounds(selectedElementBounds, elementBounds))
    ) {
      selectedElement = element;
      break;
    }
  }

  return selectedElement;
}

const headingElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
function getNearestHeadingElement(element: HTMLElement): HTMLElement | null {
  let currentElement: HTMLElement | null = element;
  while (currentElement !== null) {
    const nextElement = currentElement.previousElementSibling;
    if (nextElement === null) {
      currentElement = currentElement.parentElement;
      if (currentElement === null) {
        return null;
      }
    } else {
      currentElement = nextElement as HTMLElement;
    }
    if (headingElements.includes(currentElement.tagName.toLowerCase())) {
      return currentElement;
    }
  }
  return null;
}

function isElementInViewport(el) {
  const bounds = el.getBoundingClientRect();

  return (
    bounds.top >= 0 &&
    bounds.left >= 0 &&
    bounds.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    bounds.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function getNearestIdInViewport(element: HTMLElement): HTMLElement | null {
  let currentElement: HTMLElement | null = element;
  while (currentElement !== null) {
    const nextElement = currentElement.previousElementSibling;
    if (nextElement === null) {
      currentElement = currentElement.parentElement;
      if (currentElement === null) {
        return null;
      }
    } else {
      currentElement = nextElement as HTMLElement;
    }
    if (
      currentElement.id !== '' &&
      isElementInViewport(currentElement) &&
      // Ignore elements that are fixed or absolute as they most likely won't help with scrolling the element into view
      ['fixed', 'absolute'].includes(
        currentElement.computedStyleMap().get('position').toString()
      )
    ) {
      return currentElement;
    }
  }
  return null;
}

Sentry.init({
  // https://sentry-test.sentry.io/issues/?project=4505742647754752
  dsn: 'https://db1366bd2d586cac50181e3eaee5c3e1@o19635.ingest.sentry.io/4505742647754752',
});

function getGitHubSourcePage(): string {
  const xpath = "//a[text()='Suggest an edit to this page']";
  const matchingElement = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLAnchorElement;
  return matchingElement === null ? '' : matchingElement.href;
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const blobData = await blob.arrayBuffer();
  return new Uint8Array(blobData);
}

export function FeebdackWidget() {
  const [open, setOpen] = React.useState(false);

  const handleSubmit = async (data: {
    comment: string;
    title: string;
    image?: Blob;
    imageCutout?: Blob;
    selection?: Rect;
  }) => {
    console.log('handleSubmit data:', data);
    setOpen(false);

    const selectedElement = data.selection && getSelectedDomElement(data.selection);
    console.log('selected element:', selectedElement);
    if (selectedElement) {
      console.log('nearest heading:', getNearestHeadingElement(selectedElement));
      console.log('nearest id:', getNearestIdInViewport(selectedElement));
    }

    let eventId: string;
    const imageData = data.image && (await blobToUint8Array(data.image));
    const imageCutoutData =
      data.imageCutout && (await blobToUint8Array(data.imageCutout));

    Sentry.withScope(scope => {
      if (imageData) {
        scope.addAttachment({
          filename: 'screenshot-2.png',
          data: imageData,
          contentType: 'image/png',
        });
      }

      if (imageCutoutData) {
        scope.addAttachment({
          filename: 'screenshot.png',
          data: imageCutoutData,
          contentType: 'image/png',
        });
      }

      const sourcePage = getGitHubSourcePage();
      console.log('GitHub source page:', sourcePage);
      if (sourcePage) {
        scope.setContext('Edit Content', {
          'Source file': sourcePage,
        });
      }

      const pageTitle = document.title;
      if (pageTitle) {
        scope.setTag('page_title', pageTitle);
      }

      // We don't need breadcrumbs for now
      scope.clearBreadcrumbs();
      eventId = Sentry.captureMessage(data.title);
    });

    const userFeedback = {
      name: 'fixme name',
      email: 'test@test.com',
      comments: `${data.title}: ${data.comment}`,
      event_id: eventId,
    };
    Sentry.captureUserFeedback(userFeedback);
  };

  const handleKeyPress = useCallback(event => {
    // Shift+Enter
    if (event.shiftKey && event.keyCode === 13) {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleKeyPress]);

  return (
    <React.Fragment>
      {!open && <FeebdackButton onClick={() => setOpen(true)} />}
      <FeedbackModal open={open} onSubmit={handleSubmit} onClose={() => setOpen(false)} />
    </React.Fragment>
  );
}
