import {addDays} from "date-fns";
import Handlebars from "handlebars";
import $ from "jquery";
import assert from "minimalistic-assert";

import render_empty_required_profile_fields from "../templates/navbar_alerts/empty_required_profile_fields.hbs";
import render_insecure_desktop_app_alert_content from "../templates/navbar_alerts/insecure_desktop_app.hbs";
import render_navbar_alert_wrapper from "../templates/navbar_alerts/navbar_alert_wrapper.hbs";
import render_profile_incomplete_alert_content from "../templates/navbar_alerts/profile_incomplete.hbs";
import render_server_needs_upgrade_alert_content from "../templates/navbar_alerts/server_needs_upgrade.hbs";
import render_time_zone_update_offer_content from "../templates/navbar_alerts/time_zone_update_offer.hbs";

import * as banners from "./banners.ts";
import type {AlertBanner} from "./banners.ts";
import * as channel from "./channel.ts";
import * as desktop_notifications from "./desktop_notifications.ts";
import * as feedback_widget from "./feedback_widget.ts";
import {$t, $t_html} from "./i18n.ts";
import * as keydown_util from "./keydown_util.ts";
import type {LocalStorage} from "./localstorage.ts";
import {localstorage} from "./localstorage.ts";
import {page_params} from "./page_params.ts";
import * as people from "./people.ts";
import {current_user, realm} from "./state_data.ts";
import * as timerender from "./timerender.ts";
import {should_display_profile_incomplete_alert} from "./timerender.ts";
import * as unread from "./unread.ts";
import * as unread_ops from "./unread_ops.ts";
import {user_settings} from "./user_settings.ts";
import * as util from "./util.ts";

export function should_show_desktop_notifications_banner(ls: LocalStorage): boolean {
    // if the user said to never show banner on this computer again, it will
    // be stored as `true` so we want to negate that.
    if (localstorage.supported() && ls.get("dontAskForNotifications") === true) {
        return false;
    }

    return (
        // Spectators cannot receive desktop notifications, so never
        // request permissions to send them.
        !page_params.is_spectator &&
        // notifications *basically* don't work on any mobile platforms, so don't
        // event show the banners. This prevents trying to access things that
        // don't exist like `Notification.permission`.
        !util.is_mobile() &&
        // if permission has not been granted yet.
        !desktop_notifications.granted_desktop_notifications_permission() &&
        // if permission is allowed to be requested (e.g. not in "denied" state).
        desktop_notifications.permission_state() !== "denied"
    );
}

export function should_show_bankruptcy_banner(): boolean {
    // Until we've handled possibly declaring bankruptcy, don't show
    // unread counts since they only consider messages that are loaded
    // client side and may be different from the numbers reported by
    // the server.

    if (!page_params.furthest_read_time) {
        // We've never read a message.
        return false;
    }

    const now = Date.now() / 1000;
    if (
        unread.get_unread_message_count() > 500 &&
        now - page_params.furthest_read_time > 60 * 60 * 24 * 2
    ) {
        // 2 days.
        return true;
    }

    return false;
}

export function should_show_server_upgrade_notification(ls: LocalStorage): boolean {
    // We do not show the server upgrade nag for a week after the user
    // clicked "dismiss".
    if (!localstorage.supported() || ls.get("lastUpgradeNagDismissalTime") === undefined) {
        return true;
    }
    const last_notification_dismissal_time = ls.get("lastUpgradeNagDismissalTime");
    assert(typeof last_notification_dismissal_time === "number");

    const upgrade_nag_dismissal_duration = addDays(
        new Date(last_notification_dismissal_time),
        7,
    ).getTime();

    // show the notification only if the time duration is completed.
    return Date.now() > upgrade_nag_dismissal_duration;
}

export function maybe_show_empty_required_profile_fields_alert(): void {
    const $navbar_alert = $("#navbar_alerts_wrapper").children(".alert").first();
    const empty_required_profile_fields_exist = realm.custom_profile_fields
        .map((f) => ({
            ...f,
            value: people.my_custom_profile_data(f.id)?.value,
        }))
        .find((f) => f.required && !f.value);
    if (!empty_required_profile_fields_exist) {
        if ($navbar_alert.attr("data-process") === "profile-missing-required") {
            $navbar_alert.hide();
        }
        return;
    }

    if (!$navbar_alert?.length || $navbar_alert.is(":hidden")) {
        open({
            data_process: "profile-missing-required",
            rendered_alert_content_html: render_empty_required_profile_fields(),
        });
    }
}

export function dismiss_upgrade_nag(ls: LocalStorage): void {
    $(".alert[data-process='server-needs-upgrade'").hide();
    if (localstorage.supported()) {
        ls.set("lastUpgradeNagDismissalTime", Date.now());
    }
}

export function check_profile_incomplete(): boolean {
    if (!current_user.is_admin) {
        return false;
    }
    if (!should_display_profile_incomplete_alert(realm.realm_date_created)) {
        return false;
    }

    // Eventually, we might also check realm.realm_icon_source,
    // but it feels too aggressive to ask users to do change that
    // since their organization might not have a logo yet.
    if (
        realm.realm_description === "" ||
        /^Organization imported from [A-Za-z]+[!.]$/.test(realm.realm_description)
    ) {
        return true;
    }
    return false;
}

export function show_profile_incomplete(is_profile_incomplete: boolean): void {
    if (is_profile_incomplete) {
        // Note that this will be a noop unless we'd already displayed
        // the notice in this session.  This seems OK, given that
        // this is meant to be a one-time task for administrators.
        $("[data-process='profile-incomplete']").show();
    } else {
        $("[data-process='profile-incomplete']").hide();
    }
}

export function get_demo_organization_deadline_days_remaining(): number {
    const now = Date.now();
    assert(realm.demo_organization_scheduled_deletion_date !== undefined);
    const deadline = realm.demo_organization_scheduled_deletion_date * 1000;
    const day = 24 * 60 * 60 * 1000; // hours * minutes * seconds * milliseconds
    const days_remaining = Math.round(Math.abs(deadline - now) / day);
    return days_remaining;
}

export function should_offer_to_update_timezone(): boolean {
    // This offer is only for logged-in users with the setting enabled.
    return (
        !page_params.is_spectator &&
        user_settings.web_suggest_update_timezone &&
        !timerender.is_browser_timezone_same_as(user_settings.timezone)
    );
}

const DESKTOP_NOTIFICATIONS_BANNER: AlertBanner = {
    process: "desktop-notifications",
    intent: "brand",
    label: $t({
        defaultMessage:
            "Zulip needs your permission to enable desktop notifications for important messages.",
    }),
    buttons: [
        {
            type: "primary",
            label: $t({defaultMessage: "Enable notifications"}),
            custom_classes: "request-desktop-notifications",
        },
        {
            type: "quiet",
            label: $t({defaultMessage: "Customize notifications"}),
            custom_classes: "customize-desktop-notifications",
        },
        {
            type: "borderless",
            label: $t({defaultMessage: "Never ask on this computer"}),
            custom_classes: "reject-desktop-notifications",
        },
    ],
    close_button: true,
    custom_classes: "navbar-alert-banner",
};

const CONFIGURE_OUTGOING_MAIL_BANNER: AlertBanner = {
    process: "configure-outgoing-mail",
    intent: "warning",
    label: $t({
        defaultMessage:
            "Zulip needs to send email to confirm users' addresses and send notifications.",
    }),
    buttons: [
        {
            type: "quiet",
            label: $t({defaultMessage: "Configuration instructions"}),
            custom_classes: "configure-outgoing-mail-instructions",
        },
    ],
    close_button: true,
    custom_classes: "navbar-alert-banner",
};

const bankruptcy_banner = (): AlertBanner => {
    const old_unreads_missing = unread.old_unreads_missing;
    const unread_msgs_count = unread.get_unread_message_count();
    let label = "";
    if (old_unreads_missing) {
        label = $t(
            {
                defaultMessage:
                    "Welcome back! You have at least {unread_msgs_count} unread messages. Do you want to mark them all as read?",
            },
            {
                unread_msgs_count,
            },
        );
    } else {
        label = $t(
            {
                defaultMessage:
                    "Welcome back! You have {unread_msgs_count} unread messages. Do you want to mark them all as read?",
            },
            {
                unread_msgs_count,
            },
        );
    }
    return {
        process: "bankruptcy",
        intent: "info",
        label,
        buttons: [
            {
                type: "quiet",
                label: $t({defaultMessage: "Yes, please!"}),
                custom_classes: "accept-bankruptcy",
            },
            {
                type: "borderless",
                label: $t({defaultMessage: "No, I'll catch up."}),
                custom_classes: "banner-close-action",
            },
        ],
        close_button: true,
        custom_classes: "navbar-alert-banner",
    };
};

const demo_organization_deadline_banner = (): AlertBanner => {
    const days_remaining = get_demo_organization_deadline_days_remaining();
    return {
        process: "demo-organization-deadline",
        intent: days_remaining <= 7 ? "danger" : "info",
        label: new Handlebars.SafeString(
            $t_html(
                {
                    defaultMessage:
                        "This <z-demo-link>demo organization</z-demo-link> will be automatically deleted in {days_remaining} days, unless it's <z-convert-link>converted into a permanent organization</z-convert-link>.",
                },
                {
                    "z-demo-link": (content_html) =>
                        `<a class="banner__link" href="https://zulip.com/help/demo-organizations" target="_blank" rel="noopener noreferrer">${content_html.join("")}</a>`,
                    "z-convert-link": (content_html) =>
                        `<a class="banner__link" href="https://zulip.com/help/demo-organizations#convert-a-demo-organization-to-a-permanent-organization" target="_blank" rel="noopener noreferrer">${content_html.join("")}</a>`,
                    days_remaining,
                },
            ),
        ),
        buttons: [],
        close_button: true,
        custom_classes: "navbar-alert-banner",
    };
};

export function initialize(): void {
    const ls = localstorage();
    const browser_time_zone = timerender.browser_time_zone();
    if (realm.demo_organization_scheduled_deletion_date) {
        banners.open(demo_organization_deadline_banner(), $("#navbar_alerts_wrapper"));
    } else if (page_params.insecure_desktop_app) {
        open({
            data_process: "insecure-desktop-app",
            custom_class: "red",
            rendered_alert_content_html: render_insecure_desktop_app_alert_content(),
        });
    } else if (should_offer_to_update_timezone()) {
        open({
            data_process: "time_zone_update_offer",
            rendered_alert_content_html: render_time_zone_update_offer_content({
                browser_time_zone,
            }),
        });
    } else if (realm.server_needs_upgrade) {
        if (should_show_server_upgrade_notification(ls)) {
            open({
                data_process: "server-needs-upgrade",
                custom_class: "red",
                rendered_alert_content_html: render_server_needs_upgrade_alert_content(),
            });
        }
    } else if (page_params.warn_no_email === true && current_user.is_admin) {
        // if email has not been set up and the user is the admin,
        // display a warning to tell them to set up an email server.
        banners.open(CONFIGURE_OUTGOING_MAIL_BANNER, $("#navbar_alerts_wrapper"));
    } else if (should_show_desktop_notifications_banner(ls)) {
        banners.open(DESKTOP_NOTIFICATIONS_BANNER, $("#navbar_alerts_wrapper"));
    } else if (should_show_bankruptcy_banner()) {
        banners.open(bankruptcy_banner(), $("#navbar_alerts_wrapper"));
    } else if (check_profile_incomplete()) {
        open({
            data_process: "profile-incomplete",
            rendered_alert_content_html: render_profile_incomplete_alert_content(),
        });
    } else {
        maybe_show_empty_required_profile_fields_alert();
    }

    // Configure click handlers.
    $("#navbar_alerts_wrapper").on(
        "click",
        ".request-desktop-notifications",
        function (this: HTMLElement): void {
            void (async () => {
                const $banner = $(this).closest(".banner");
                const permission =
                    await desktop_notifications.request_desktop_notifications_permission();
                if (permission === "granted" || permission === "denied") {
                    banners.close($banner);
                }
            })();
        },
    );

    $("#navbar_alerts_wrapper").on("click", ".customize-desktop-notifications", () => {
        window.location.hash = "#settings/notifications";
    });

    $("#navbar_alerts_wrapper").on(
        "click",
        ".reject-desktop-notifications",
        function (this: HTMLElement) {
            const $banner = $(this).closest(".banner");
            banners.close($banner);
            ls.set("dontAskForNotifications", true);
        },
    );

    $("#navbar_alerts_wrapper").on("click", ".accept-bankruptcy", function (this: HTMLElement) {
        const $accept_button = $(this);
        $accept_button.prop("disabled", true).css("pointer-events", "none");
        const $banner = $(this).closest(".banner");
        unread_ops.mark_all_as_read();
        setTimeout(() => {
            banners.close($banner);
        }, 2000);
    });

    $("#navbar_alerts_wrapper").on("click", ".configure-outgoing-mail-instructions", () => {
        window.open(
            "https://zulip.readthedocs.io/en/latest/production/email.html",
            "_blank",
            "noopener,noreferrer",
        );
    });

    $(".dismiss-upgrade-nag").on("click", (e: JQuery.ClickEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dismiss_upgrade_nag(ls);
    });

    $("#navbar_alerts_wrapper").on(
        "click",
        ".alert .close, .alert .exit",
        function (this: HTMLElement, e) {
            e.stopPropagation();
            const $process = $(this).closest("[data-process]");
            $(this).closest(".alert").hide();
            if ($process.attr("data-process") !== "profile-missing-required") {
                maybe_show_empty_required_profile_fields_alert();
            }
            $(window).trigger("resize");
        },
    );

    $(".time-zone-update").on("click", function (e) {
        e.preventDefault();
        void channel.patch({
            url: "/json/settings",
            data: {timezone: browser_time_zone},
            success: () => {
                $(this).closest(".alert").hide();
                $(window).trigger("resize");
                feedback_widget.show({
                    title_text: $t({defaultMessage: "Time zone updated"}),
                    populate($container) {
                        $container.text(
                            $t(
                                {
                                    defaultMessage: "Your time zone was updated to {time_zone}.",
                                },
                                {time_zone: browser_time_zone},
                            ),
                        );
                    },
                });
            },
            error() {
                feedback_widget.show({
                    title_text: $t({defaultMessage: "Could not update time zone"}),
                    populate($container) {
                        $container.text(
                            $t({defaultMessage: "Unexpected error updating the timezone."}),
                        );
                    },
                });
            },
        });
    });

    $(".time-zone-auto-detect-off").on("click", function (e) {
        e.preventDefault();
        void channel.patch({
            url: "/json/settings",
            data: {web_suggest_update_timezone: false},
            success: () => {
                $(this).closest(".alert").hide();
                $(window).trigger("resize");
                feedback_widget.show({
                    title_text: $t({defaultMessage: "Setting updated"}),
                    populate($container) {
                        $container.text(
                            $t({
                                defaultMessage:
                                    "You will no longer be prompted to update your time zone.",
                            }),
                        );
                    },
                });
            },
            error() {
                feedback_widget.show({
                    title_text: $t({defaultMessage: "Unable to update setting"}),
                    populate($container) {
                        $container.text(
                            $t({defaultMessage: "There was an error updating the setting."}),
                        );
                    },
                });
            },
        });
    });

    // Treat Enter with links in the navbar alerts UI focused like a click.,
    $("#navbar_alerts_wrapper").on("keyup", ".alert-link[role=button]", function (e) {
        e.stopPropagation();
        if (keydown_util.is_enter_event(e)) {
            $(this).trigger("click");
        }
    });
}

export function open(args: {
    data_process: string;
    rendered_alert_content_html: string;
    custom_class?: string | undefined;
}): void {
    const rendered_alert_wrapper_html = render_navbar_alert_wrapper(args);

    // Note: We only support one alert being rendered at a time; as a
    // result, we just replace the alert area in the DOM with the
    // indicated alert. We do this to avoid bad UX, as it'd look weird
    // to have more than one alert visible at a time.
    $("#navbar_alerts_wrapper").html(rendered_alert_wrapper_html);
    $(window).trigger("resize");
}
