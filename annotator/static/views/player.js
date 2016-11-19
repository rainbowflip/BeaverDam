"use strict";


// Constants. ES6 doesn't support class constants yet, thus this hack.
var PlayerViewConstants = {
    // Value of .player-control-scrubber[max]
    CONTROL_SCRUBBER_GRANULARITY: 10000,

    // How often the UI updates the displayed time
    TIME_UPDATE_DELAY: 30 /* ms */,
};


class PlayerView {
    constructor({$container, videoSrc, videoStart, videoEnd}) {
        // This container of the player
        this.$container = $container;

        // The Raphael paper (canvas) for annotations
        this.$paper = null;

        // Namespaced className generator
        this.classBaseName = new Misc.ClassNameGenerator('player');

        // The invisible rect that receives drag events not targeted at speciifc
        this.creationRect = null;

        // The keyframebar
        this.keyframebar = null;

        // Timer id used to increate <video>.on('timeupdate') frequency
        this.manualTimeupdateTimerId = null;

        // The rects
        this.rects = null;

        // Timder id for rewind
        this.rewindTimerId = null;

        // Is something being dragged?
        this.dragInProgress = false;

        // The <video> object
        this.video = null;

        // Video URL
        this.videoSrc = videoSrc;

        // Video start time
        this.videoStart = videoStart;

        // Video end time
        this.videoEnd = videoEnd;

        // Promises
        this.keyframebarReady = Misc.CustomPromise();
        this.paperReady = Misc.CustomPromise();
        this.videoReady = Misc.CustomPromise();

        // We're ready when all the components are ready.
        this.ready = Misc.CustomPromiseAll(
            this.keyframebarReady(),
            this.paperReady(),
            this.videoReady()
        );

        // Prevent adding new properties
        Misc.preventExtensions(this, PlayerView);

        this.initHandlers();
        this.initPaper();
        this.initVideo();
        this.initKeyframebar();
    }


    // Init ALL the annotations!

    initKeyframebar() {
        this.keyframebar = new Keyframebar({classBaseName: this.classBaseName});
        this.keyframebar.attach(this.$('keyframebar'));
        this.keyframebarReady.resolve();
    }

    initPaper() {
        // Depends on this.videoReady for this.video.videoWidth/Height
        this.videoReady().then(() => {
            var {videoWidth, videoHeight} = this.video;
            this.$paper = Raphael(this.$('paper')[0], videoWidth, videoHeight);

            $(this.$paper.canvas).attr({
                viewBox: `0 0 ${videoWidth} ${videoHeight}`
            }).removeAttr(
                'width'
            ).removeAttr(
                'height'
            ).css({
                position: 'relative',
                'max-width': `${videoWidth}px`,
                'max-height': `${videoHeight}px`,
            });
            this.creationRect = this.makeAndAttachRect(CreationRect);
            this.rects = [];

            $(this.creationRect).on('create-bounds', (e, bounds) => {
                var rect = this.addRect();
                rect.bounds = bounds;
                rect.focus();
                $(this).triggerHandler('create-rect', rect);
            });

            this.paperReady.resolve();
        });
    }

    initVideo() {
        this.video = AbstractFramePlayer.newFramePlayer(this.$('video')[0], { images: imageList, videoSrc: this.videoSrc });

        // need to set the current time by default -  if (this.videoStart != null) { this.video.currentTime = this.videoStart; }
        this.video.onPlaying(() => {
            clearInterval(this.manualTimeupdateTimerId);
            this.manualTimeupdateTimerId = setInterval(() => {
                this.video.triggerTimerUpdateHandler();
            }, this.TIME_UPDATE_DELAY);
        });
        this.video.onPause(() => {
            clearInterval(this.manualTimeupdateTimerId);
        });
        this.video.onLoadedMetadata(() => {
            this.videoReady.resolve();
        });
        this.video.onAbort(() => {
            this.videoReady.reject();
        });
    }

    initHandlers() {
        this.ready().then(() => {
            // key => better key events
            $(document).keydown(Misc.fireEventByKeyCode.bind(this));
            $(document).keyup(Misc.fireEventByKeyCode.bind(this));

            // control-time <=> video
            this.$on('control-time', 'change', () => this.video.currentTime = this.controlTime);
            this.video.onTimeUpdate(() => this.controlTimeUnfocused = this.video.currentTime);
            this.video.onPlaying(() => this.togglePlayPauseIcon())
            this.video.onPause(() => this.togglePlayPauseIcon())

            // control-scrubber <=> video
            this.$on('control-scrubber', 'change input', () => this.jumpToTimeAndPause(this.controlScrubber));
            this.video.onTimeUpdate(() => this.controlScrubberInactive = this.video.currentTime);

            // keyframebar => video
            $(this.keyframebar).on('jump-to-time', (e, time) => this.jumpToTimeAndPause(time));

            // controls => video
            this.$on('control-play-pause', 'click', (event) => {this.playPause()});
            this.$on('control-goto-start', 'click', () => this.jumpToTimeAndPause(0));
            this.$on('control-goto-end', 'click', () => this.jumpToTimeAndPause(this.video.duration));
            this.$on('control-delete-keyframe', 'click', () => this.deleteKeyframe());

            // better key events => video
            // play/pause
            $(this).on('keydn-space            ', () => this.playPause());
            // rewind-play
            $(this).on('keydn-semicolon keydn-q', () => this.rewind());
            $(this).on('keyup-semicolon keyup-q', () => this.stopRewind());
            // step-play
            $(this).on('keydn-period    keydn-e', () => this.play());
            $(this).on('keyup-period    keyup-e', () => this.pause());
            // Delete keyframe
            $(this).on('                keydn-d', () => this.deleteKeyframe());
            // Keyframe stepping
            $(this).on('keydn-g                ', () => this.stepforward());
            $(this).on('keydn-f                ', () => this.stepbackward());
            // video frame stepping
            $(this).on('keydn-q      ', () => this.video.previousFrame());
            $(this).on('keydn-w     ', () => this.video.nextFrame());
        });
    }

    // Time control
    stepforward() {
        $(this).trigger('step-forward-keyframe');
    }

    stepbackward() {
        $(this).trigger('step-backward-keyframe');
    }

    play() {
        if (this.video.currentTime < this.video.duration) {
            this.video.play();
        }
        return false;
    }

    pause() {
        this.video.pause();
        return false;
    }

    playPause() {
        if (this.video.paused) {

            return this.play();
        }
        else {
            return this.pause();
        }
    }

    jumpToTimeAndPause(time) {
        this.video.currentTime = time;
        this.video.pause();
    }

    stepTime(timeDelta) {
        this.video.currentTime += timeDelta;
        return false;
    }

    rewindStep() {
        if (this.video.currentTime <= 0) {
            this.stopRewind();
        }
        else {
            this.video.currentTime -= 0.1;
        }
    }

    rewind() {
        this.video.pause();
        clearInterval(this.rewindTimerId);
        this.rewindTimerId = setInterval(this.rewindStep.bind(this), 100);
        this.rewindStep();
        return false;
    }

    stopRewind() {
        clearInterval(this.rewindTimerId);
        return false;
    }

    deleteKeyframe() {
        $(this).trigger('delete-keyframe');
    }

    checkTimeRange() {
        var currentTime = this.$('control-time').val();
        var time = {
            closestTimeinRange: currentTime,
            violatesEndTime: false,
            violatesStartTime: false,
        };
        if (this.videoStart != null && currentTime < this.videoStart) {
            time.closestTimeinRange = this.videoStart;
            time.violatesStartTime = true;
        } else if (this.videoEnd != null && currentTime > this.videoEnd) {
            time.closestTimeinRange = this.videoEnd;
            time.violatesEndTime = true;
        }
        return time;
    }

    fixVideoTime(newTime) {
        if (newTime != null) {
            this.video.currentTime = newTime;
        }
        this.pause();
    }

    // Rect control

    metrics() {
        return {
            offset: $(this.$paper.canvas).offset(),
            original: {
                height: this.$paper.height,
                width: this.$paper.width,
            },
            scale: $(this.$paper.canvas).height() / this.$paper.height,
        };
    }

    makeAndAttachRect(KindOfRect) {
        var {classBaseName} = this;
        var rect = new KindOfRect({classBaseName});
        rect.attach(this.$paper, this.metrics.bind(this));

        // In case drag exceeds bounds of object, set it as the cursor of the
        // entire paper
        $(rect).on('change-cursor', (e, cursor) => {
            if (this.dragInProgress) return;
            this.$('paper').css({cursor});
        });

        // .. but don't change it if there's we're in the middle of a drag
        $(rect).on('drag-start', () => {
            this.dragInProgress = true;
        });
        $(rect).on('drag-end', () => {
            this.dragInProgress = false;
        });
        return rect;
    }


    addRect() {
        var rect = this.makeAndAttachRect(Rect);
        this.rects.push(rect);
        return rect;
    }

    deleteRect(rect) {
        if (rect == null) return false;

        for (let i = 0; i < this.rects.length; i++) {
            if (this.rects[i] === rect) {
                rect.detach();
                this.rects.splice(i, 1);
                return true;
            }
        }
        throw new Error("PlayerView.deleteRect: rect not found", rect);
    }

    togglePlayPauseIcon() {
        var btnIcon = $('.player-control-play-pause');
        if (this.video.paused) {
            btnIcon.addClass('glyphicon-play');
            btnIcon.removeClass('glyphicon-pause');
        }
        else {
            btnIcon.addClass('glyphicon-pause');
            btnIcon.removeClass('glyphicon-play');
        }
    }


    // UI getters and setters

    get controlTime() {
        return parseFloat(this.$('control-time').val());
    }

    get controlTimeUnfocused() {
        return this.controlTime;
    }

    set controlTimeUnfocused(value) {
        var timeRange = this.checkTimeRange();
        this.$('control-time:not(:focus)').val(value.toFixed(2));
        if (timeRange.violatesStartTime || timeRange.violatesEndTime) {
            this.fixVideoTime(timeRange.closestTimeinRange);
        }
    }

    get controlScrubber() {
        return parseFloat(this.$('control-scrubber').val()) / this.CONTROL_SCRUBBER_GRANULARITY * this.video.duration;
    }

    get controlScrubberInactive() {
        return this.controlScrubber;
    }

    set controlScrubberInactive(value) {
        var timeRange = this.checkTimeRange();
        this.$('control-scrubber:not(:active)').val(value * this.CONTROL_SCRUBBER_GRANULARITY / this.video.duration);
        if (timeRange.violatesStartTime || timeRange.violatesEndTime) {
            this.fixVideoTime(timeRange.closestTimeinRange);
        }
    }


    // DOM/jQuery helpers

    $(extension) {
        return this.$container.find(this.classBaseName.add(extension).toSelector());
    }

    $on(extension, eventName, callback) {
        return this.$container.on(eventName, this.classBaseName.add(extension).toSelector(), callback);
    }
}

// Mix-in constants
Misc.mixinClassConstants(PlayerView, PlayerViewConstants);
void PlayerView;
