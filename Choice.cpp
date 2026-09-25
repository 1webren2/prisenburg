#include "Choice.h"

#include "GameState.h"

Choice::Choice(const std::string& text, const std::string& nextSceneId)
    : nextSceneId_(nextSceneId), text_(text) {}

void Choice::setCondition(std::function<bool(const GameState&)> condition) {
    condition_ = condition;
}

void Choice::setEffect(std::function<void(GameState&)> effect) {
    effect_ = effect;
}

bool Choice::isAvailable(const GameState& state) const {
    if (condition_ == nullptr) {
        return true;
    }
    return condition_(state);
}

void Choice::applyEffect(GameState& state) const {
    if (effect_ != nullptr) {
        effect_(state);
    }
}
